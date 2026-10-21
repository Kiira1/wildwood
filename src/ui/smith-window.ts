import { itemDefinition, itemDisplayName, itemStats } from "../../shared/items";
import {
  REFINE_MAX, REFINE_ORES, isRefinableItem, refineCost, refineSafeLimit, refineSuccessChance, type OreId,
} from "../../shared/refine";
import { itemArtMarkup } from "../game/item-presentation";
import { itemInspectionButtonLabel } from "./item-inspection-controller";
import { formatEquipmentStat } from "./equipment-stat-format";
import { refineStars } from "./refine-badge";
import { REFINE_ORE_ORDER } from "../../shared/ore-bag";
import { itemTier } from "../../shared/item-tier";
import { GRADE_SHOP_LINES, gradeShopLineKey } from "../../shared/grade-shop";
import { weaponSchool as schoolOfWeapon, type WeaponSchool } from "../../shared/weapon-mastery";
import { craftDepsFor, createCraftSection, gradeItemRow, type CraftCoop, type CraftSectionDeps } from "./craft-section";
import { mountToolSection, toolDepsFor, type ToolSectionDeps } from "./tool-section";
import { schoolLines, schoolWeaponName, type WornLoadout } from "./smith-buy-plan";

type Result = { ok: boolean; error?: string } | undefined;
type RefineResult = { itemId: string; copyId: bigint; fromLevel: number; toLevel: number; succeeded: boolean };
/** One copy of an item the player holds: copy id 0 is the first copy, the one a slot holds. */
export type SmithItem = { itemId: string; copyId: bigint; equipped: boolean };

const key = (item: { itemId: string; copyId: bigint }) => `${item.itemId}:${item.copyId}`;
/** The bag's filters for the gear the Smith works on. */
const SMITH_FILTERS = [["ALL", "All"], ["HAND", "Weapons"], ["CHEST", "Armor"], ["HEAD", "Helmets"], ["FEET", "Boots"]] as const;
const nameOf = (itemId: string) => itemInspectionButtonLabel(itemDisplayName(itemId));
// Refine Luck moves the odds by fractions of a percent, so they keep their decimals (2.2%, 0.031%).
const percent = (chance: number) => {
  const value = chance * 100;
  return `${Number(value.toFixed(value >= 10 ? 1 : value >= 1 ? 2 : 3))}%`;
};

/** The Smith's tabs, one job each, and which lines Craft lists; both kept on the device. Buying is the sellers' (gear-seller-window.ts). */
export type SmithView = "craft" | "reforge" | "refine" | "tools";
type GearShown = "yours" | "all";
const VIEW_STORE = "wildstat.smithView", SHOWN_STORE = "wildstat.smithGearShown";
const VIEW_NAMES: Readonly<Record<SmithView, string>> = { craft: "Craft", reforge: "Reforge", refine: "Refine", tools: "Tools" };
// Tabs a device kept before these.
const OLD_VIEWS: Readonly<Record<string, SmithView>> = { gear: "craft", buy: "craft", upgrade: "tools", slots: "tools" };
// Yours / All Gear on Craft.
const SHOWN_BAR = `<div class="inventory-filters smith-shown" role="group" aria-label="Lines shown"></div>`;
function stored(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* this visit only */ }
}

/**
 * The Smith's window, in the Town's smithy: he makes and improves gear. Craft a new piece, Reforge a weapon held,
 * Refine a copy (see what a try costs and how likely it is), and upgrade the tools. The server rolls and decides
 * (craft_grade_item, reforge_weapon, refine_item, upgrade_tool); this window only shows the odds, asks, and shows how it went.
 */
export function createSmithController(deps: {
  inTown: () => boolean;
  clearInput?: () => void;
  items: () => SmithItem[];
  refineLevel: (itemId: string, copyId: bigint) => number;
  /** The slot's tier, for the stat preview: refines multiply the stat as the slot tier has left it. */
  slotTier: (itemId: string) => number;
  ores: () => Readonly<Partial<Record<OreId, number>>>;
  refine: (itemId: string, copyId: bigint, expectedLevel: number) => Promise<Result>;
  /** Refine Luck's rank, which raises the odds the server rolls against. */
  refineLuck?: () => number;
  showMessage: (text: string, color: string) => void;
  /** The Mining (shared/mining.ts) and Woodcutting (shared/woodcutting.ts) stats, beside where the ore and wood are. */
  mining?: () => number;
  woodcutting?: () => number;
  /** Smithing, Fletching and Enchanting: every line crafted here, on the Craft tab, and Reforge (craft-section.ts). */
  craft?: CraftSectionDeps;
  tools?: ToolSectionDeps;
  /** What the player wears, for the Craft tab's Yours; read from the worn items when left out. */
  worn?: () => WornLoadout;
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "farm-sheet quest-sheet smith-sheet";
  dialog.setAttribute("aria-labelledby", "smithTitle");
  dialog.innerHTML = `<header class="farm-header"><h2 id="smithTitle" class="window-banner"><span>The Smith</span></h2></header>`
    + `<div class="quest-body"><div class="smith-views-bar"><div class="inventory-filters smith-views" role="group" aria-label="Smith view"></div></div>`
    // Refine first in the page, so its button is the window's first: the view bar decides what shows.
    + `<section class="smith-view smith-refine-view" data-view="refine">`
    + `<p class="farm-map smith-intro">Refine gear with ore. Safe up to its limit; past it a try can fail, and a fail costs only the ore.</p>`
    + `<section class="smith-focus" aria-live="polite"></section>`
    + `<p class="smith-ores" aria-label="Your ores"></p>`
    + `<div class="smith-section-head"><strong>Your Gear</strong><span class="smith-items-count"></span></div>`
    + `<div class="inventory-filters smith-filters" role="group" aria-label="Show gear"></div>`
    + `<p class="smith-empty smith-filter-empty" hidden></p>`
    + `<div class="smith-items" role="listbox" aria-label="Your gear"></div></section>`
    + `<section class="smith-view smith-craft-view" data-view="craft"><section class="smith-shop" aria-labelledby="smithCraftTitle">`
    + `<div class="smith-shop-bar">${SHOWN_BAR}</div>`
    + `<div class="smith-shop-head"><h3 id="smithCraftTitle" class="smith-list-title"></h3></div>`
    + `<div class="smith-shop-rows smith-craft-rows" role="list" aria-label="Gear to craft"></div></section></section>`
    // Reforge: each weapon copy held, one Reforge each.
    + `<section class="smith-view smith-reforge-view" data-view="reforge">`
    + `<p class="farm-map smith-intro">Roll a weapon's skills again for the same materials as crafting it. Each skill keeps the better roll.</p>`
    + `<p class="smith-empty smith-reforge-empty" hidden>No weapon to reforge yet. Craft one first.</p>`
    + `<div class="smith-shop-rows smith-reforge-rows" role="list" aria-label="Weapons to reforge"></div></section>`
    // Tools: the five tools, and where their ore and wood come from.
    + `<section class="smith-view smith-tools-view" data-view="tools">`
    + `<div class="smith-tools"></div>`
    + `<div class="smith-mining"><span class="smith-mining-text"></span></div>`
    + `<div class="smith-mining"><span class="smith-woodcutting-text"></span></div>`
    + `</section></div>`

    + `<footer class="farm-footer"><div class="farm-actions"><button type="button" class="window-back-button">Back</button></div></footer>`;
  document.body.append(dialog);
  const focus = dialog.querySelector<HTMLElement>(".smith-focus")!;
  const oreLine = dialog.querySelector<HTMLElement>(".smith-ores")!;
  const list = dialog.querySelector<HTMLElement>(".smith-items")!;
  const back = dialog.querySelector<HTMLButtonElement>(".window-back-button")!;
  const miningText = dialog.querySelector<HTMLElement>(".smith-mining-text")!;
  const woodcuttingText = dialog.querySelector<HTMLElement>(".smith-woodcutting-text")!;
  const filterBar = dialog.querySelector<HTMLElement>(".smith-filters")!;
  const filterEmpty = dialog.querySelector<HTMLElement>(".smith-filter-empty")!;
  const craftRows = dialog.querySelector<HTMLElement>(".smith-craft-rows")!;
  const reforgeRows = dialog.querySelector<HTMLElement>(".smith-reforge-rows")!, reforgeEmpty = dialog.querySelector<HTMLElement>(".smith-reforge-empty")!;
  const viewBar = dialog.querySelector<HTMLElement>(".smith-views")!;
  const itemsCount = dialog.querySelector<HTMLElement>(".smith-items-count")!;
  // The three crafts' levels head the Craft tab; each row there is its line's craft line.
  const crafts = deps.craft ? createCraftSection(deps.craft, { onChange: () => { if (dialog.open) render(); } }) : null;
  if (crafts) dialog.querySelector(".smith-craft-view .smith-shop-bar")!.before(crafts.element);
  const tools = mountToolSection(dialog, deps.tools, () => { if (dialog.open) render(); });
  // Making first, then improving: crafting, reforging, refining and the tools.
  const views = ([
    ["craft", Boolean(deps.craft)], ["reforge", Boolean(deps.craft)], ["refine", true], ["tools", Boolean(deps.tools || deps.mining || deps.woodcutting)],
  ] as const).filter(([, shown]) => shown).map(([view]) => view as SmithView);
  const storedView = () => { const value = stored(VIEW_STORE) ?? ""; return views.find(each => each === (OLD_VIEWS[value] ?? value)); };
  let view: SmithView = storedView() ?? views[0];
  let gearShown: GearShown = stored(SHOWN_STORE) === "all" ? "all" : "yours";
  viewBar.parentElement!.hidden = views.length < 2;
  for (const each of views) {
    const button = pillButton(VIEW_NAMES[each], () => { if (view !== each) { view = each; store(VIEW_STORE, each); render(); } });
    button.dataset.view = each;
    viewBar.append(button);
  }
  for (const bar of dialog.querySelectorAll<HTMLElement>(".smith-shown")) {
    for (const [each, label] of [["yours", "Yours"], ["all", "All Gear"]] as const) {
      const button = pillButton(label, () => { if (gearShown !== each) { gearShown = each; store(SHOWN_STORE, each); render(); } });
      button.dataset.shown = each;
      bar.append(button);
    }
  }
  /** The gear shown, as the bag filters it: everything, or one kind. */
  let shown: (typeof SMITH_FILTERS)[number][0] = "ALL";
  for (const [kind, label] of SMITH_FILTERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inventory-filter";
    button.dataset.filter = kind;
    button.textContent = label;
    button.addEventListener("click", () => { if (shown !== kind) { shown = kind; render(); } });
    filterBar.append(button);
  }
  let selected: string | null = null;
  let refining = false;
  let lastResult: { text: string; good: boolean } | null = null;
  let renderedState = "";

  function choices() {
    return deps.items().filter(item => isRefinableItem(item.itemId) && (shown === "ALL" || itemDefinition(item.itemId)?.slot === shown))
      // Worn first, then the bag by tier as the bag sorts it, highest first; a kept copy after its first copy.
      .sort((a, b) => Number(b.equipped) - Number(a.equipped) || (itemTier(b.itemId) ?? 0) - (itemTier(a.itemId) ?? 0)
        || nameOf(a.itemId).localeCompare(nameOf(b.itemId)) || (a.copyId < b.copyId ? -1 : 1));
  }

  /** What the player wears, slot by slot. */
  function wornNow(): WornLoadout {
    if (deps.worn) return deps.worn();
    const worn: WornLoadout = {};
    for (const item of deps.items()) {
      if (!item.equipped || item.copyId !== 0n) continue;
      const slot = itemDefinition(item.itemId)?.slot;
      if (slot === "HAND") worn.equippedRightHand = item.itemId;
      else if (slot === "HEAD") worn.equippedHead = item.itemId;
      else if (slot === "CHEST") worn.equippedChest = item.itemId;
      else if (slot === "FEET") worn.equippedFeet = item.itemId;
    }
    return worn;
  }

  /** The school of the weapon in hand: its lines are the player's own. */
  function school(worn = wornNow()): WeaponSchool {
    return schoolOfWeapon(worn.equippedRightHand || worn.equippedLeftHand || "");
  }

  function renderFocus(item: SmithItem | undefined) {
    if (!item) {
      focus.innerHTML = `<p class="smith-empty">Bring the Smith a weapon, helmet, armor or boots to refine.</p>`;
      return;
    }
    const level = deps.refineLevel(item.itemId, item.copyId), next = level + 1, tier = deps.slotTier(item.itemId);
    const atTop = level >= REFINE_MAX, safe = refineSafeLimit(item.itemId), chance = atTop ? 0 : refineSuccessChance(item.itemId, next, deps.refineLuck?.() ?? 0);
    const cost = atTop ? null : refineCost(item.itemId, next);
    const held = deps.ores();
    const short = cost ? Object.entries(cost).filter(([oreId, count]) => (held[oreId as OreId] ?? 0) < (count ?? 0)) : [];
    const [now] = itemStats(item.itemId, { tier, refine: level }), [after] = atTop ? [""] : itemStats(item.itemId, { tier, refine: next });
    focus.replaceChildren();
    // Title case, as the item window shows stats ("Damage +7%").
    const stat = formatEquipmentStat(itemInspectionButtonLabel(now ?? ""));
    const head = itemHead(item, atTop ? `${stat} · Fully Refined` : `${stat} → ${formatEquipmentStat(after?.split(" ").pop() ?? "")}`);
    const facts = document.createElement("dl");
    facts.className = "smith-facts";
    const fact = (label: string, value: string, tone = "") => {
      const row = document.createElement("div");
      if (tone) row.className = tone;
      row.innerHTML = "<dt></dt><dd></dd>";
      row.querySelector("dt")!.textContent = label;
      row.querySelector("dd")!.textContent = value;
      facts.append(row);
    };
    if (!atTop) {
      fact("Chance", next <= safe ? "Safe" : percent(chance), next <= safe ? "is-safe" : "is-risky");
      fact("Safe to", `★${safe}`);
      fact("Costs", Object.entries(cost!).map(([oreId, count]) => `${count} ${REFINE_ORES[oreId as OreId].name}`).join(" + "));
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "farm-start smith-refine";
    button.textContent = atTop ? `★${REFINE_MAX}` : refining ? "Refining…" : "Refine";
    button.disabled = atTop || refining || short.length > 0;
    if (short.length) button.textContent = `Need ${short.map(([oreId]) => REFINE_ORES[oreId as OreId].name).join(" + ")}`;
    button.addEventListener("click", () => { void refine(item, level); });
    focus.append(head, facts, button);
    appendOutcome();
  }

  function itemHead(item: SmithItem, line: string) {
    const head = document.createElement("div");
    head.className = "smith-item";
    head.innerHTML = `<span class="smith-art">${itemArtMarkup(item.itemId)}</span><span class="smith-copy"><strong></strong><span class="smith-stat"></span></span>`;
    head.querySelector("strong")!.textContent = `${nameOf(item.itemId)} ${refineStars(deps.refineLevel(item.itemId, item.copyId))}`.trim();
    head.querySelector(".smith-stat")!.textContent = line;
    return head;
  }

  function appendOutcome() {
    if (!lastResult) return;
    const outcome = document.createElement("p");
    outcome.className = `smith-outcome ${lastResult.good ? "is-good" : "is-bad"}`;
    outcome.textContent = lastResult.text;
    focus.append(outcome);
  }

  function render() {
    crafts?.render();
    tools?.render();
    const items = choices();
    if (!selected || !items.some(item => key(item) === selected)) selected = items[0] ? key(items[0]) : null;
    const chosen = items.find(item => key(item) === selected);
    // Presence updates also refresh open windows. Keep focus and buttons in place until this window changes.
    const state = JSON.stringify([
      view, gearShown, wornNow(), shown, selected, refining, lastResult,
      deps.ores(), deps.mining?.(), deps.woodcutting?.(), crafts?.state(),
      items.map(item => [key(item), item.equipped, deps.refineLevel(item.itemId, item.copyId), deps.slotTier(item.itemId)]),
    ]);
    if (state === renderedState) return;
    renderedState = state;
    for (const section of dialog.querySelectorAll<HTMLElement>(".smith-view")) section.hidden = section.dataset.view !== view;
    for (const button of viewBar.querySelectorAll<HTMLButtonElement>("[data-view]")) button.setAttribute("aria-pressed", String(button.dataset.view === view));
    itemsCount.textContent = items.length ? String(items.length) : "";
    for (const button of filterBar.querySelectorAll<HTMLButtonElement>(".inventory-filter")) button.setAttribute("aria-pressed", String(button.dataset.filter === shown));
    filterEmpty.hidden = items.length > 0 || shown === "ALL";
    filterEmpty.textContent = `No ${SMITH_FILTERS.find(([kind]) => kind === shown)?.[1].toLowerCase() ?? "gear"} to bring`;
    renderFocus(chosen);
    const held = deps.ores();
    oreLine.textContent = REFINE_ORE_ORDER.map(oreId => `${REFINE_ORES[oreId].name} ${held[oreId] ?? 0}`).join(" · ");
    // Where the ore and wood come from: every player holds a pickaxe and a hatchet.
    miningText.textContent = `Mining ${deps.mining?.() ?? 0} · Ore is in the Copper Hills, east of Town`;
    woodcuttingText.textContent = `Woodcutting ${deps.woodcutting?.() ?? 0} · Wood is in Timberwood, north of the Copper Hills`;
    // Only the tab on screen lists its rows; picking another tab renders it.
    if (view === "craft") renderCraft(wornNow());
    else if (view === "reforge") renderReforge();
    list.replaceChildren(...items.map(item => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "smith-choice";
      option.setAttribute("role", "option");
      const isSelected = key(item) === selected, level = deps.refineLevel(item.itemId, item.copyId);
      option.setAttribute("aria-selected", String(isSelected));
      option.setAttribute("aria-label", `${nameOf(item.itemId)} ${refineStars(level)}${item.equipped ? ", worn" : ""}`.trim());
      option.innerHTML = `<span class="smith-choice-art">${itemArtMarkup(item.itemId)}</span>`
        + (level > 0 ? `<span class="refine-badge">${refineStars(level)}</span>` : "")
        + (item.equipped ? `<span class="smith-worn">Worn</span>` : "");
      option.addEventListener("click", () => {
        selected = key(item); lastResult = null; render();
      });
      return option;
    }));
  }

  /** The lines Craft lists: the weapon in hand's (Yours), or every line. */
  function shownLines(worn: WornLoadout) {
    for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-shown]")) button.setAttribute("aria-pressed", String(button.dataset.shown === gearShown));
    for (const title of dialog.querySelectorAll(".smith-list-title")) title.textContent = gearShown === "all" ? "All Gear" : `For Your ${schoolWeaponName(school(worn))}`;
    const yours = schoolLines(school(worn)).map(gradeShopLineKey);
    return gearShown === "all" ? GRADE_SHOP_LINES : GRADE_SHOP_LINES.filter(line => yours.includes(gradeShopLineKey(line)));
  }

  /** Craft: materials only. One row per line, its craft line at the grade the craft's level opens (craft-section.ts). */
  function renderCraft(worn: WornLoadout) {
    craftRows.replaceChildren(...shownLines(worn).map(line => {
      const made = crafts!.craftLine(line), { row, deal } = gradeItemRow(made.itemId);
      deal.append(made.line);
      return row;
    }));
  }

  /** Reforge: one row per weapon copy held (craft-section.ts reforgeRows). */
  function renderReforge() {
    const rows = crafts!.reforgeRows();
    reforgeEmpty.hidden = rows.length > 0;
    reforgeRows.replaceChildren(...rows);
  }

  async function refine(item: SmithItem, level: number) {
    if (refining) return;
    refining = true;
    lastResult = null;
    render();
    try {
      const result = await deps.refine(item.itemId, item.copyId, level);
      if (!result?.ok) {
        lastResult = { text: result?.error ?? "Not connected", good: false };
        deps.showMessage(result?.error ?? "Not Connected", "#ff9b91");
      }
    } finally {
      refining = false;
      if (dialog.open) render();
    }
  }

  /** The server's verdict on a try (player_refine_result), shown where the player is looking. */
  function showResult(result: RefineResult) {
    const name = `${nameOf(result.itemId)} ${refineStars(result.toLevel) || "★0"}`;
    lastResult = result.succeeded
      ? { text: `Success! ${name}`, good: true }
      : { text: "It failed. Nothing lost but the ore.", good: false };
    deps.showMessage(result.succeeded ? `Refined · ${name}` : `Refine Failed · ${name}`, result.succeeded ? "#ffd75e" : "#ff9b91");
    if (dialog.open) render();
  }

  function close() {
    if (!dialog.open) return false;
    dialog.close();
    deps.clearInput?.();
    return true;
  }

  /** Opens on the tab asked for, else the one last picked. */
  function open(on?: SmithView) {
    if (!deps.inTown() || dialog.open) return;
    view = on && views.includes(on) ? on : storedView() ?? views[0];
    lastResult = null;
    crafts?.reset();
    render();
    deps.clearInput?.();
    dialog.showModal();
    back.focus();
  }

  back.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  return {
    open, close, isOpen: () => dialog.open, render, showResult, destroy() { close(); dialog.remove(); },
  };
}

/** A pill in a toggle: pressed is the one shown. */
function pillButton(label: string, onClick: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inventory-filter";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

/** The Smith as main.ts uses it: crafting and refining through the coop session, the bag's copies, and each try's verdict. */
export function createSmithRuntime(deps: {
  coop: () => (CraftCoop & {
    mining?: () => number;
    woodcutting?: () => number;
    itemRefine?: (itemId: string, copyId?: bigint) => number;
    itemUpgradeLevel?: (itemId: string) => number;
    ores?: () => Readonly<Partial<Record<OreId, number>>>;
    refineItem?: (itemId: string, copyId: bigint, expectedLevel: number) => Promise<Result>;
    researchInPlay?: () => { refineLuck?: number };
    setOnRefineResult?: (callback: ((result: RefineResult) => void) | null) => void;
  }) | null | undefined;
  inventory: { itemIds: string[]; equippedHead: string; equippedChest: string; equippedFeet?: string; equippedRightHand: string; equippedLeftHand: string };
  showMessage: (text: string, color: string) => void;
  clearInput?: () => void;
  inTown: () => boolean;
}) {
  const { inventory } = deps;
  const worn = () => new Set([inventory.equippedHead, inventory.equippedChest, inventory.equippedFeet ?? "", inventory.equippedRightHand, inventory.equippedLeftHand]);
  const smith = createSmithController({
    inTown: deps.inTown, clearInput: deps.clearInput, showMessage: deps.showMessage,
    items: () => {
      const wearing = worn();
      return [
        ...[...new Set(inventory.itemIds)].map(itemId => ({ itemId, copyId: 0n, equipped: wearing.has(itemId) })),
        ...(deps.coop()?.equipmentCopies?.() ?? []).map(copy => ({ itemId: copy.itemId, copyId: copy.id, equipped: false })),
      ];
    },
    refineLevel: (itemId, copyId) => deps.coop()?.itemRefine?.(itemId, copyId) ?? 0,
    slotTier: itemId => deps.coop()?.itemUpgradeLevel?.(itemId) ?? 0,
    ores: () => deps.coop()?.ores?.() ?? {},
    refine: async (itemId, copyId, expectedLevel) => deps.coop()?.refineItem?.(itemId, copyId, expectedLevel) ?? { ok: false, error: "Not Connected" },
    refineLuck: () => deps.coop()?.researchInPlay?.()?.refineLuck ?? 0,
    mining: () => deps.coop()?.mining?.() ?? 0,
    woodcutting: () => deps.coop()?.woodcutting?.() ?? 0,
    craft: craftDepsFor(deps.coop, inventory, deps.showMessage),
    tools: toolDepsFor(deps.coop, deps.showMessage),
    worn: () => inventory,
  });
  let listening = false;
  return {
    ...smith,
    open(view?: SmithView) {
      // Each try's verdict arrives as a row; listen from the first visit the session is up for.
      const coop = deps.coop();
      if (!listening && coop?.setOnRefineResult) { coop.setOnRefineResult(result => smith.showResult(result)); listening = true; }
      smith.open(view);
    },
  };
}
