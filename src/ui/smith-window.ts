import { itemDisplayName, itemStats } from "../../shared/items";
import {
  REFINE_MAX, REFINE_ORES, isRefinableItem, refineCost, refineSafeLimit, refineSuccessChance, type OreId,
} from "../../shared/refine";
import { itemArtMarkup } from "../game/item-presentation";
import { itemInspectionButtonLabel } from "./item-inspection-controller";
import { formatEquipmentStat } from "./equipment-stat-format";
import { refineStars } from "./refine-badge";
import { ORE_ORDER } from "../../shared/ore-bag";

type Result = { ok: boolean; error?: string } | undefined;
type RefineResult = { itemId: string; copyId: bigint; fromLevel: number; toLevel: number; succeeded: boolean };
/** One copy of an item the player holds: copy id 0 is the first copy, the one a slot holds. */
export type SmithItem = { itemId: string; copyId: bigint; equipped: boolean };

const key = (item: { itemId: string; copyId: bigint }) => `${item.itemId}:${item.copyId}`;
const nameOf = (itemId: string) => itemInspectionButtonLabel(itemDisplayName(itemId));
const percent = (chance: number) => `${Math.round(chance * 100)}%`;

/**
 * The Smith's window, in the Town's smithy: pick a copy of an item, see what a try costs and how likely it is,
 * and refine it. The server rolls and decides (refine_item); this window only shows the odds, asks, and shows
 * how it went.
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
  showMessage: (text: string, color: string) => void;
  /** Mining (shared/mining.ts): the free pickaxe he hands over, and the Mining stat once it is in hand. */
  hasPickaxe?: () => boolean;
  claimPickaxe?: () => Promise<Result>;
  mining?: () => number;
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "farm-sheet quest-sheet smith-sheet";
  dialog.setAttribute("aria-labelledby", "smithTitle");
  dialog.innerHTML = `<header class="farm-header"><h2 id="smithTitle" class="window-banner"><span>The Smith</span></h2></header>`
    + `<div class="quest-body"><p class="farm-map smith-intro">Refine gear with ore. Safe up to its limit; past it a fail drops one ★.</p>`
    + `<section class="smith-focus" aria-live="polite"></section>`
    + `<p class="smith-ores" aria-label="Your ores"></p>`
    + `<div class="smith-mining"><span class="smith-mining-text"></span><button type="button" class="farm-start smith-refine smith-pickaxe">Take a Pickaxe</button></div>`
    + `<div class="smith-items" role="listbox" aria-label="Your gear"></div></div>`
    + `<footer class="farm-footer"><div class="farm-actions"><button type="button" class="window-back-button">Back</button></div></footer>`;
  document.body.append(dialog);
  const focus = dialog.querySelector<HTMLElement>(".smith-focus")!;
  const oreLine = dialog.querySelector<HTMLElement>(".smith-ores")!;
  const list = dialog.querySelector<HTMLElement>(".smith-items")!;
  const back = dialog.querySelector<HTMLButtonElement>(".window-back-button")!;
  const miningText = dialog.querySelector<HTMLElement>(".smith-mining-text")!;
  const pickaxeButton = dialog.querySelector<HTMLButtonElement>(".smith-pickaxe")!;
  let selected: string | null = null;
  let refining = false;
  /** Taken here and on its way: the button goes before the server's row arrives. */
  let pickaxeTaken = false, takingPickaxe = false;
  let lastResult: { text: string; good: boolean } | null = null;

  function choices() {
    return deps.items().filter(item => isRefinableItem(item.itemId))
      // Worn first, then the bag; a kept copy after its first copy.
      .sort((a, b) => Number(b.equipped) - Number(a.equipped) || a.itemId.localeCompare(b.itemId) || (a.copyId < b.copyId ? -1 : 1));
  }

  function renderFocus(item: SmithItem | undefined) {
    if (!item) {
      focus.innerHTML = `<p class="smith-empty">Bring the Smith a bow, helmet or armor to refine.</p>`;
      return;
    }
    const level = deps.refineLevel(item.itemId, item.copyId), next = level + 1, tier = deps.slotTier(item.itemId);
    const atTop = level >= REFINE_MAX, safe = refineSafeLimit(item.itemId), chance = atTop ? 0 : refineSuccessChance(item.itemId, next);
    const cost = atTop ? null : refineCost(item.itemId, next);
    const held = deps.ores();
    const short = cost ? Object.entries(cost).filter(([oreId, count]) => (held[oreId as OreId] ?? 0) < (count ?? 0)) : [];
    const [now] = itemStats(item.itemId, { tier, refine: level }), [after] = atTop ? [""] : itemStats(item.itemId, { tier, refine: next });
    focus.replaceChildren();
    const head = document.createElement("div");
    head.className = "smith-item";
    head.innerHTML = `<span class="smith-art">${itemArtMarkup(item.itemId)}</span><span class="smith-copy"><strong></strong><span class="smith-stat"></span></span>`;
    head.querySelector("strong")!.textContent = `${nameOf(item.itemId)} ${refineStars(level)}`.trim();
    // Title case, as the item window shows stats ("Damage +7%").
    const stat = formatEquipmentStat(itemInspectionButtonLabel(now ?? ""));
    head.querySelector(".smith-stat")!.textContent = atTop ? `${stat} · Fully Refined` : `${stat} → ${formatEquipmentStat(after?.split(" ").pop() ?? "")}`;
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
      if (next > safe) fact("If it fails", level > 0 ? `Drops to ${refineStars(level - 1) || "★0"}` : "Stays at ★0", "is-risky");
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
    if (lastResult) {
      const outcome = document.createElement("p");
      outcome.className = `smith-outcome ${lastResult.good ? "is-good" : "is-bad"}`;
      outcome.textContent = lastResult.text;
      focus.append(outcome);
    }
  }

  function render() {
    const items = choices();
    if (!selected || !items.some(item => key(item) === selected)) selected = items[0] ? key(items[0]) : null;
    renderFocus(items.find(item => key(item) === selected));
    const held = deps.ores();
    oreLine.textContent = ORE_ORDER.map(oreId => `${REFINE_ORES[oreId].name} ${held[oreId] ?? 0}`).join(" · ");
    // Where the ore comes from, and the pickaxe to get it with.
    const pickaxe = pickaxeTaken || Boolean(deps.hasPickaxe?.());
    miningText.textContent = pickaxe ? `Mining ${deps.mining?.() ?? 0} · Ore is in the Copper Hills, east of Town` : "Ore is in the Copper Hills, east of Town.";
    pickaxeButton.hidden = pickaxe || !deps.claimPickaxe;
    pickaxeButton.disabled = takingPickaxe;
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
      option.addEventListener("click", () => { selected = key(item); lastResult = null; render(); });
      return option;
    }));
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
      : { text: `It failed. ${result.toLevel < result.fromLevel ? `Dropped to ${refineStars(result.toLevel) || "★0"}` : "Nothing lost but the ore"}.`, good: false };
    deps.showMessage(result.succeeded ? `Refined · ${name}` : `Refine Failed · ${name}`, result.succeeded ? "#ffd75e" : "#ff9b91");
    if (dialog.open) render();
  }

  function close() {
    if (!dialog.open) return false;
    dialog.close();
    deps.clearInput?.();
    return true;
  }

  function open() {
    if (!deps.inTown() || dialog.open) return;
    lastResult = null;
    render();
    deps.clearInput?.();
    dialog.showModal();
    back.focus();
  }

  pickaxeButton.addEventListener("click", async () => {
    if (takingPickaxe || !deps.claimPickaxe) return;
    takingPickaxe = true;
    render();
    try {
      const result = await deps.claimPickaxe();
      if (result?.ok) {
        pickaxeTaken = true;
        deps.showMessage("The Smith hands you a pickaxe. Walk east to the Copper Hills.", "#ffd75e");
      } else deps.showMessage(result?.error ?? "Not Connected", "#ff9b91");
    } finally {
      takingPickaxe = false;
      if (dialog.open) render();
    }
  });
  back.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  return { open, close, isOpen: () => dialog.open, render, showResult, destroy() { close(); dialog.remove(); } };
}

/** The Smith as main.ts uses it: refining through the coop session, the bag's copies, and each try's verdict. */
export function createSmithRuntime(deps: {
  coop: () => {
    hasPickaxe?: () => boolean;
    claimPickaxe?: () => Promise<Result>;
    mining?: () => number;
    itemRefine?: (itemId: string, copyId?: bigint) => number;
    itemUpgradeLevel?: (itemId: string) => number;
    ores?: () => Readonly<Partial<Record<OreId, number>>>;
    refineItem?: (itemId: string, copyId: bigint, expectedLevel: number) => Promise<Result>;
    equipmentCopies?: () => readonly { id: bigint; itemId: string }[];
    setOnRefineResult?: (callback: ((result: RefineResult) => void) | null) => void;
  } | null | undefined;
  inventory: { itemIds: string[]; equippedHead: string; equippedChest: string; equippedRightHand: string; equippedLeftHand: string };
  showMessage: (text: string, color: string) => void;
  clearInput?: () => void;
  inTown: () => boolean;
}) {
  const { inventory } = deps;
  const worn = () => new Set([inventory.equippedHead, inventory.equippedChest, inventory.equippedRightHand, inventory.equippedLeftHand]);
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
    hasPickaxe: () => deps.coop()?.hasPickaxe?.() ?? false,
    claimPickaxe: async () => deps.coop()?.claimPickaxe?.() ?? { ok: false, error: "Not Connected" },
    mining: () => deps.coop()?.mining?.() ?? 0,
  });
  let listening = false;
  return {
    ...smith,
    open() {
      // Each try's verdict arrives as a row; listen from the first visit the session is up for.
      const coop = deps.coop();
      if (!listening && coop?.setOnRefineResult) { coop.setOnRefineResult(result => smith.showResult(result)); listening = true; }
      smith.open();
    },
  };
}
