import { ITEM_DEFINITIONS } from "../../../shared/items";
import { ITEM_PRESENTATIONS } from "../../game/item-presentation";
import { loadPlayerAppearanceAssets, PLAYER_SKIN_TONE_NAMES } from "../../game/player-appearance";
import { PLAYER_LAYERS, type PlayerLayer, type LayerBounds } from "../../game/player-layer-alignment";
import { adjustmentKey, alignment, freshDraft, identityAdjustment, defaultAdjustment, LAYER_NAMES, parseDraft, SLOT_LAYERS, type Outfit } from "./state";
import { localDragDelta, renderPreview } from "./preview";
import { createWeaponPicker } from "./weapon-picker";
import { vendorWeapon } from "./vendor-weapons";
import { gripAtPoint, withGrip } from "./weapon-transform";
import { baselineSummary } from "./baseline-summary";
import { createProjectSave } from "./project-save";

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = (id: string) => get<HTMLSelectElement>(id);
const button = (id: string) => get<HTMLButtonElement>(id);
const field = (id: string) => get<HTMLInputElement>(id);
const DRAFT_KEY = "wildstat-character-studio-v1";
let draft = freshDraft(), selected: PlayerLayer = "helmet";
let pickingGrip = false;
let hasLocalDraft = false;
let playing = false, time = 0, dirty = true, previousTime = 0;
let bounds = new Map<PlayerLayer, LayerBounds>();
const undo: string[] = [], redo: string[] = [];
const status = (text: string, error = false) => { get("saveStatus").textContent = text; get("saveStatus").dataset.error = String(error); };
try {
  const saved = localStorage.getItem(DRAFT_KEY);
  if (saved) { draft = parseDraft(JSON.parse(saved)); hasLocalDraft = true; status("Draft restored"); }
  else status("Ready to align");
} catch { status("Could not restore draft. Import an exported copy.", true); }
const preview = get<HTMLCanvasElement>("preview"), reference = get<HTMLCanvasElement>("reference");
const assets = loadPlayerAppearanceAssets(() => { dirty = true; checkAssets(); });
function checkAssets() {
  const images = [assets.basicFrontLeg, assets.basicBackLeg, ...Object.values(draft.outfit).flatMap(id => Object.values(assets.equipment[id] ?? {}))];
  const missing = images.filter(image => image.complete && !image.naturalWidth);
  const loading = images.some(image => !image.complete);
  get("assetStatus").textContent = missing.length ? missing.length + " missing images — check asset paths" : loading ? "Loading selected artwork…" : "Using the live game renderer";
  get("assetStatus").dataset.error = String(missing.length > 0);
  get("baselineHint").textContent = baselineSummary(draft, selected, assets);
}
const title = (text: string) => text.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
for (const [slot, kind] of Object.entries(SLOT_LAYERS)) {
  const control = select(slot);
  control.add(new Option("None", ""));
  for (const [id, presentation] of Object.entries(ITEM_PRESENTATIONS)) {
    const world = presentation.world;
    if ((world?.kind === "LEGS" ? "LEGS" : world?.layer) === kind)
      control.add(new Option(title(ITEM_DEFINITIONS[id as keyof typeof ITEM_DEFINITIONS].name), id));
  }
  control.addEventListener("change", () => {
    pickingGrip = false;
    checkpoint();
    draft.outfit[slot as keyof Outfit] = control.value;
    selected = slot === "headItem" ? "helmet" : slot === "chestItem" ? "chest" : slot === "feetItem" ? "frontLeg" : "weapon";
    changed();
  });
}
const syncWeapon = createWeaponPicker(assets, () => { dirty = true; checkAssets(); });
PLAYER_SKIN_TONE_NAMES.forEach((name, index) => select("skinTone").add(new Option(title(name), String(index))));
select("skinTone").addEventListener("change", () => { checkpoint(); draft.skinTone = Number(select("skinTone").value); changed(); });
const layerButtons = new Map<PlayerLayer, HTMLButtonElement>();
for (const layer of [...PLAYER_LAYERS].reverse()) {
  const control = document.createElement("button"); control.type = "button";
  control.addEventListener("click", () => { selected = layer; sync(); });
  layerButtons.set(layer, control); get("layers").append(control);
}
function equipped(layer: PlayerLayer) {
  return layer === "helmet" ? Boolean(draft.outfit.headItem) : layer === "chest" ? Boolean(draft.outfit.chestItem)
    : layer === "weapon" ? Boolean(draft.outfit.rightHandItem) : true;
}
function sync() {
  if (selected !== "weapon") pickingGrip = false;
  syncWeapon(draft.outfit.rightHandItem);
  for (const slot of Object.keys(SLOT_LAYERS)) select(slot).value = draft.outfit[slot as keyof Outfit];
  select("basis").value = draft.basis ?? "game";
  select("skinTone").value = String(draft.skinTone);
  for (const [layer, control] of layerButtons) {
    control.replaceChildren(document.createTextNode(LAYER_NAMES[layer]));
    const note = document.createElement("small");
    note.textContent = !equipped(layer) ? "Not equipped" : draft.adjustments[adjustmentKey(draft, layer)] ? "Adjusted" : "";
    control.append(note); control.setAttribute("aria-pressed", String(layer === selected));
  }
  const adjustment = alignment(draft)[selected] ?? identityAdjustment();
  get("eyeControls").hidden = selected !== "eyes";
  field("eyeSpacing").value = String(Math.round((adjustment.spacing ?? 1) * 100));
  field("angle").value = String(adjustment.angle ?? 0);
  field("x").value = String(adjustment.x); field("y").value = String(adjustment.y); field("scale").value = String(Math.round(adjustment.scale * 100));
  for (const id of ["x", "y", "scale", "angle"]) field(id).disabled = !equipped(selected);
  get("weaponTransforms").hidden = selected !== "weapon";
  button("flipWeapon").disabled = button("pickGrip").disabled = !equipped("weapon");
  button("flipWeapon").setAttribute("aria-pressed", String(Boolean(adjustment.flipX)));
  button("pickGrip").setAttribute("aria-pressed", String(pickingGrip));
  button("pickGrip").textContent = pickingGrip ? "Click the handle…" : "Set grip point";
  preview.dataset.pickingGrip = String(pickingGrip);
  button("reset").disabled = !draft.adjustments[adjustmentKey(draft, selected)];
  button("undo").disabled = undo.length === 0; button("redo").disabled = redo.length === 0;
  get("inspectorTitle").textContent = get("selectedName").textContent = LAYER_NAMES[selected];
  get("layerHint").textContent = equipped(selected) ? (selected === "eyes" ? "Eye edits save for this helmet. Use Ghost helmet to see the fit." : selected === "weapon" ? "Set the grip on the handle. Rotation and flipping keep that point fixed." : "Offsets are in source pixels. Positive vertical moves down.") : "Choose an item above to adjust this layer.";
  const vendor = vendorWeapon(draft.outfit.rightHandItem);
  select("basis").options[0].text = vendor && !vendor.gameItemId ? vendor.category === "Sword" ? "Shared sword alignment" : "Vendor default placement" : "Current game alignment";
  get("referenceLabel").textContent = select("referenceBasis").value === "source" ? "Natural artwork size" : vendor && !vendor.gameItemId ? vendor.category === "Sword" ? "Shared sword alignment" : "Vendor default · not yet in game" : "Current game alignment";
  dirty = true; checkAssets();
}
function checkpoint() { undo.push(JSON.stringify(draft)); if (undo.length > 100) undo.shift(); redo.length = 0; }
function persist() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); status("Draft saved on this device"); }
  catch { status("Storage full or unavailable. Export to keep your changes.", true); }
  projectSave.changed();
}
function changed() { sync(); persist(); }
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n * 100) / 100));
for (const axis of ["x", "y", "scale", "angle"] as const) field(axis).addEventListener("change", () => {
  const value = field(axis).valueAsNumber;
  if (!Number.isFinite(value)) { sync(); return; }
  checkpoint();
  const key = adjustmentKey(draft, selected), adjustment = draft.adjustments[key] ?? defaultAdjustment(draft, selected);
  adjustment[axis] = axis === "scale" ? clamp(value / 100, .25, 2) : axis === "angle" ? clamp(value, -180, 180) : clamp(value, -1000, 1000);
  draft.adjustments[key] = adjustment; changed();
});
field("eyeSpacing").addEventListener("change", () => {
  const value = field("eyeSpacing").valueAsNumber;
  if (!Number.isFinite(value)) { sync(); return; }
  checkpoint();
  const key = adjustmentKey(draft, "eyes");
  draft.adjustments[key] = { ...(draft.adjustments[key] ?? defaultAdjustment(draft, selected)), spacing: clamp(value / 100, .25, 2) };
  changed();
});
button("editEyes").addEventListener("click", () => { selected = "eyes"; sync(); });
button("editHead").addEventListener("click", () => { selected = "head"; sync(); });
button("flipWeapon").addEventListener("click", () => {
  checkpoint();
  const key = adjustmentKey(draft, "weapon"), value = draft.adjustments[key] ?? defaultAdjustment(draft, "weapon");
  draft.adjustments[key] = { ...value, flipX: !value.flipX }; changed();
});
button("pickGrip").addEventListener("click", () => {
  pickingGrip = !pickingGrip; setPlaying(false); sync();
});
button("turnAround").addEventListener("click", () => {
  select("facing").value = select("facing").value === "left" ? "right" : "left"; sync();
});
button("reset").addEventListener("click", () => { checkpoint(); delete draft.adjustments[adjustmentKey(draft, selected)]; changed(); });
function historyMove(from: string[], to: string[]) {
  const previous = from.pop(); if (!previous) return;
  to.push(JSON.stringify(draft)); draft = parseDraft(JSON.parse(previous)); changed();
}
button("undo").addEventListener("click", () => historyMove(undo, redo));
button("redo").addEventListener("click", () => historyMove(redo, undo));
function setPlaying(value: boolean) {
  if (value && pickingGrip) { pickingGrip = false; sync(); }
  playing = value; button("play").textContent = playing ? "Pause" : "Play";
  button("play").setAttribute("aria-pressed", String(playing)); dirty = true;
}
button("play").addEventListener("click", () => setPlaying(!playing));
button("step").addEventListener("click", () => { setPlaying(false); time += .1; dirty = true; });
for (const id of ["pose", "facing", "aim", "zoom", "background", "guides", "referenceBasis", "helmetView"]) get(id).addEventListener("change", () => { sync(); });
select("vendorOverlay").addEventListener("change", () => {
  if (select("vendorOverlay").value) { selected = "head"; select("helmetView").value = "ghost"; }
  get("overlayStatus").textContent = select("vendorOverlay").value ? "Reference overlay · not exported" : "";
  sync();
});
field("overlayOpacity").addEventListener("input", () => { dirty = true; });
select("basis").addEventListener("change", () => { checkpoint(); draft.basis = select("basis").value as "game" | "source"; changed(); });
select("pose").addEventListener("change", () => { time = 0; setPlaying(true); });
const point = (event: PointerEvent) => { const rect = preview.getBoundingClientRect(); return { x: (event.clientX - rect.left) * preview.width / rect.width, y: (event.clientY - rect.top) * preview.height / rect.height }; };
let drag: { pointer: number; x: number; y: number; start: ReturnType<typeof identityAdjustment>; bounds: LayerBounds; changed: boolean } | null = null;
preview.addEventListener("pointerdown", event => {
  const p = point(event);
  if (pickingGrip) {
    const rectangle = bounds.get("weapon");
    const grip = rectangle && gripAtPoint(rectangle, p.x, p.y);
    if (!grip || !rectangle?.source) return;
    checkpoint();
    const key = adjustmentKey(draft, "weapon");
    draft.adjustments[key] = withGrip(draft.adjustments[key] ?? defaultAdjustment(draft, "weapon"), rectangle.source, grip.x, grip.y);
    pickingGrip = false; changed(); return;
  }
  const contains = ([, b]: [PlayerLayer, LayerBounds]) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  // A chosen layer stays draggable even where a helmet or chest overlaps it.
  const selectedBounds = bounds.get(selected);
  const hit = selectedBounds && contains([selected, selectedBounds]) ? [selected, selectedBounds] as const : [...bounds].reverse().find(contains);
  if (!hit) return;
  selected = hit[0]; setPlaying(false);
  drag = { pointer: event.pointerId, ...p, start: { ...(alignment(draft)[selected] ?? identityAdjustment()) }, bounds: hit[1], changed: false };
  preview.setPointerCapture(event.pointerId); preview.focus(); sync();
});
preview.addEventListener("pointermove", event => {
  if (!drag || event.pointerId !== drag.pointer) return;
  const p = point(event), delta = localDragDelta(drag.bounds, p.x - drag.x, p.y - drag.y);
  if (!drag.changed && Math.hypot(delta.x, delta.y) < .1) return;
  if (!drag.changed) { checkpoint(); drag.changed = true; }
  draft.adjustments[adjustmentKey(draft, selected)] = { ...drag.start, x: clamp(drag.start.x + delta.x, -1000, 1000), y: clamp(drag.start.y + delta.y, -1000, 1000) };
  sync();
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) preview.addEventListener(name, () => { if (drag) { drag = null; persist(); } });
preview.addEventListener("keydown", event => {
  const dx = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  const dy = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if ((!dx && !dy) || !equipped(selected)) return;
  event.preventDefault(); checkpoint(); setPlaying(false);
  const key = adjustmentKey(draft, selected), value = draft.adjustments[key] ?? defaultAdjustment(draft, selected);
  const rectangle = bounds.get(selected), step = event.shiftKey ? 5 : 1;
  const screenScale = rectangle?.axes ? Math.hypot(rectangle.axes.a, rectangle.axes.b) : 1;
  const delta = localDragDelta(rectangle ?? { x: 0, y: 0, width: 0, height: 0 }, dx * step * screenScale, dy * step * screenScale);
  draft.adjustments[key] = { ...value, x: clamp(value.x + delta.x, -1000, 1000), y: clamp(value.y + delta.y, -1000, 1000) }; changed();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && pickingGrip) { pickingGrip = false; sync(); return; }
  if ((event.target as HTMLElement).matches("input, select, textarea")) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault(); event.shiftKey ? historyMove(redo, undo) : historyMove(undo, redo);
  } else if (event.code === "Space" && event.target === preview) { event.preventDefault(); setPlaying(!playing); }
});
const serialize = () => JSON.stringify(draft, null, 2);
button("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([serialize()], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "wildstat-character-alignment.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); status("Alignment exported");
});
button("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(serialize()); status("Alignment copied"); }
  catch { status("Clipboard unavailable. Use Download JSON copy.", true); }
});
field("import").addEventListener("change", async () => {
  const file = field("import").files?.[0]; if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error("Alignment file is too large.");
    const imported = parseDraft(JSON.parse(await file.text())); checkpoint(); draft = imported; changed();
  } catch (error) { status(error instanceof Error ? error.message : "Could not import alignment.", true); }
  field("import").value = "";
});
new ResizeObserver(() => { dirty = true; }).observe(get("preview"));
document.addEventListener("visibilitychange", () => { previousTime = 0; dirty = true; });
function frame(now: number) {
  if (playing && !document.hidden) { time += previousTime ? Math.min(.05, (now - previousTime) / 1000) : 0; dirty = true; }
  previousTime = now;
  if (dirty && !document.hidden) {
    const options = { draft, selected, time, pose: select("pose").value, facing: select("facing").value, aim: select("aim").value,
      zoom: Number(select("zoom").value), guides: field("guides").checked, background: select("background").value, referenceBasis: select("referenceBasis").value, helmetView: select("helmetView").value,
      vendorOverlay: select("vendorOverlay").value, overlayOpacity: field("overlayOpacity").valueAsNumber / 100, redraw: () => { dirty = true; } };
    if (reference.clientWidth) renderPreview(reference, assets, options, false);
    bounds = renderPreview(preview, assets, options, true); dirty = false;
  }
  requestAnimationFrame(frame);
}
const projectSave = createProjectSave({ getDraft: () => draft, status, restore: saved => {
  checkpoint(); draft = saved; sync();
  try { localStorage.setItem(DRAFT_KEY, serialize()); } catch { /* The project file is already saved. */ }
} });
sync(); requestAnimationFrame(frame);
void projectSave.initialize(hasLocalDraft);
