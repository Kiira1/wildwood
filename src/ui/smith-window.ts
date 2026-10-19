import { STARTER_STAFF, itemDefinition, itemDisplayName, itemStats } from "../../shared/items";
import {
  REFINE_MAX, REFINE_ORES, isRefinableItem, refineCost, refineSafeLimit, refineSuccessChance, type OreId,
} from "../../shared/refine";
import { itemArtMarkup } from "../game/item-presentation";
import { itemInspectionButtonLabel } from "./item-inspection-controller";
import { formatEquipmentStat } from "./equipment-stat-format";
import { refineStars } from "./refine-badge";
import { REFINE_ORE_ORDER } from "../../shared/ore-bag";
import { itemTier } from "../../shared/item-tier";
import { ARMOR_CLASS_DETAILS, ARMOR_CLASS_NAMES, GEAR_GRADE_NAMES } from "../../shared/gear-grades";
import { armorClassOf, gradeEquipmentKindOf, gradeOf, type GradeItemId } from "../../shared/grade-equipment";
import {
  GRADE_SHOP_LINES, gradeShopNeed, gradeShopOffer, gradeShopOpen, gradeShopPrice, masteryLevels, type MasteryLevels,
} from "../../shared/grade-shop";
import { bagSlotsWithOres } from "../../shared/ore-bag";
import { bagSlotCapacity } from "../../shared/gems";
import type { WeaponSchool } from "../../shared/weapon-mastery";
import { formatGemAmount } from "./number-format";

type Result = { ok: boolean; error?: string } | undefined;
type RefineResult = { itemId: string; copyId: bigint; fromLevel: number; toLevel: number; succeeded: boolean };
/** One copy of an item the player holds: copy id 0 is the first copy, the one a slot holds. */
export type SmithItem = { itemId: string; copyId: bigint; equipped: boolean };

const key = (item: { itemId: string; copyId: bigint }) => `${item.itemId}:${item.copyId}`;
/** The bag's filters for the gear the Smith works on (boots are not refined). */
const SMITH_FILTERS = [["ALL", "All"], ["HAND", "Weapons"], ["CHEST", "Armor"], ["HEAD", "Helmets"]] as const;
const nameOf = (itemId: string) => itemInspectionButtonLabel(itemDisplayName(itemId));
// The HUD's gold coin, beside every price in gold.
const GOLD_COIN = `<svg class="smith-coin" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="#e3b23c" stroke="#7a4f12" stroke-width="1.5"/><circle cx="10" cy="10" r="5.5" fill="none" stroke="#a8741d" stroke-width="1.2"/></svg>`;
const KIND_NAMES = { bow: "Bow", sword: "Sword", staff: "Staff", helmet: "Helmet", armor: "Armor" } as const;
// Refine Luck moves the odds by fractions of a percent, so they keep their decimals (2.2%, 0.031%).
const percent = (chance: number) => {
  const value = chance * 100;
  return `${Number(value.toFixed(value >= 10 ? 1 : value >= 1 ? 2 : 3))}%`;
};

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
  /** Refine Luck's rank, which raises the odds the server rolls against. */
  refineLuck?: () => number;
  showMessage: (text: string, color: string) => void;
  /** Mining (shared/mining.ts): the free pickaxe he hands over, and the Mining stat once it is in hand. */
  hasPickaxe?: () => boolean;
  claimPickaxe?: () => Promise<Result>;
  mining?: () => number;
  /** Woodcutting (shared/woodcutting.ts): the free hatchet he hands over as he does the pickaxe, and the stat once it is in hand. */
  hasHatchet?: () => boolean;
  claimHatchet?: () => Promise<Result>;
  woodcutting?: () => number;
  /** The free Starter Staff he hands out, as he does the pickaxe. */
  hasStarterStaff?: () => boolean;
  claimStarterStaff?: () => Promise<Result>;
  /** The gear shop: graded gear for gold, opened by Mastery (shared/grade-shop.ts); the server decides (buy_grade_gear). */
  gold?: () => bigint;
  masteryLevels?: () => MasteryLevels;
  /** Every item held, worn or on the Upgrade Bench; the bag's own items when left out. */
  heldItems?: () => readonly string[];
  bagFull?: () => boolean;
  buyGear?: (itemId: string, expectedPrice: number) => Promise<Result>;
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "farm-sheet quest-sheet smith-sheet";
  dialog.setAttribute("aria-labelledby", "smithTitle");
  dialog.innerHTML = `<header class="farm-header"><h2 id="smithTitle" class="window-banner"><span>The Smith</span></h2></header>`
    + `<div class="quest-body"><p class="farm-map smith-intro">Refine gear with ore. Safe up to its limit; past it a try can fail, and a fail costs only the ore.</p>`
    + `<section class="smith-focus" aria-live="polite"></section>`
    + `<p class="smith-ores" aria-label="Your ores"></p>`
    + `<div class="smith-mining"><span class="smith-mining-text"></span><button type="button" class="farm-start smith-refine smith-pickaxe">Take a Pickaxe</button></div>`
    + `<div class="smith-mining smith-hatchet-row"><span class="smith-woodcutting-text"></span><button type="button" class="farm-start smith-refine smith-hatchet">Take a Hatchet</button></div>`
    + `<div class="smith-mining smith-staff-row"><span class="smith-mining-text">Starter Staff · Casts bolts that burst on a pack</span><button type="button" class="farm-start smith-refine smith-staff">Take a Staff</button></div>`
    + `<div class="inventory-filters smith-filters" role="group" aria-label="Show gear"></div>`
    + `<p class="smith-empty smith-filter-empty" hidden></p>`
    + `<div class="smith-items" role="listbox" aria-label="Your gear"></div>`
    + `<section class="smith-shop" aria-labelledby="smithShopTitle"><div class="smith-shop-head"><h3 id="smithShopTitle">Gear for Gold</h3>`
    + `<span class="smith-gold" aria-label="Your gold">${GOLD_COIN}<strong></strong></span></div>`
    + `<div class="smith-shop-rows" role="list" aria-label="Gear for sale"></div></section></div>`
    + `<footer class="farm-footer"><div class="farm-actions"><button type="button" class="window-back-button">Back</button></div></footer>`;
  document.body.append(dialog);
  const focus = dialog.querySelector<HTMLElement>(".smith-focus")!;
  const oreLine = dialog.querySelector<HTMLElement>(".smith-ores")!;
  const list = dialog.querySelector<HTMLElement>(".smith-items")!;
  const back = dialog.querySelector<HTMLButtonElement>(".window-back-button")!;
  const miningText = dialog.querySelector<HTMLElement>(".smith-mining-text")!;
  const pickaxeButton = dialog.querySelector<HTMLButtonElement>(".smith-pickaxe")!;
  const hatchetRow = dialog.querySelector<HTMLElement>(".smith-hatchet-row")!;
  const woodcuttingText = dialog.querySelector<HTMLElement>(".smith-woodcutting-text")!;
  const hatchetButton = dialog.querySelector<HTMLButtonElement>(".smith-hatchet")!;
  const staffRow = dialog.querySelector<HTMLElement>(".smith-staff-row")!;
  const staffButton = dialog.querySelector<HTMLButtonElement>(".smith-staff")!;
  const filterBar = dialog.querySelector<HTMLElement>(".smith-filters")!;
  const filterEmpty = dialog.querySelector<HTMLElement>(".smith-filter-empty")!;
  const shop = dialog.querySelector<HTMLElement>(".smith-shop")!;
  const goldLine = dialog.querySelector<HTMLElement>(".smith-gold strong")!;
  const shopRows = dialog.querySelector<HTMLElement>(".smith-shop-rows")!;
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
  /** Taken here and on its way: the button goes before the server's row arrives. */
  let pickaxeTaken = false, takingPickaxe = false, takingStaff = false, hatchetTaken = false, takingHatchet = false;
  let lastResult: { text: string; good: boolean } | null = null;
  let renderedState = "";
  /** The piece being bought, and the ones bought here before the server's row arrives. */
  let buyingGear: string | null = null;
  const justBought = new Set<string>();

  function choices() {
    return deps.items().filter(item => isRefinableItem(item.itemId) && (shown === "ALL" || itemDefinition(item.itemId)?.slot === shown))
      // Worn first, then the bag by tier as the bag sorts it, highest first; a kept copy after its first copy.
      .sort((a, b) => Number(b.equipped) - Number(a.equipped) || (itemTier(b.itemId) ?? 0) - (itemTier(a.itemId) ?? 0)
        || nameOf(a.itemId).localeCompare(nameOf(b.itemId)) || (a.copyId < b.copyId ? -1 : 1));
  }

  function renderFocus(item: SmithItem | undefined) {
    if (!item) {
      focus.innerHTML = `<p class="smith-empty">Bring the Smith a weapon, helmet or armor to refine.</p>`;
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
    const items = choices();
    if (!selected || !items.some(item => key(item) === selected)) selected = items[0] ? key(items[0]) : null;
    const chosen = items.find(item => key(item) === selected);
    // Presence updates also refresh open windows. Keep focus and buttons in place until this window changes.
    const state = JSON.stringify([
      shown, selected, refining, lastResult, pickaxeTaken, takingPickaxe, takingStaff, deps.hasStarterStaff?.(),
      deps.ores(), deps.hasPickaxe?.(), deps.mining?.(), hatchetTaken, takingHatchet, deps.hasHatchet?.(), deps.woodcutting?.(), shopState(),
      items.map(item => [key(item), item.equipped, deps.refineLevel(item.itemId, item.copyId), deps.slotTier(item.itemId)]),
    ]);
    if (state === renderedState) return;
    renderedState = state;
    // Shown until the bag holds one; a thrown-away staff can be taken again.
    staffRow.hidden = !deps.claimStarterStaff || Boolean(deps.hasStarterStaff?.());
    staffButton.disabled = takingStaff;
    for (const button of filterBar.querySelectorAll<HTMLButtonElement>(".inventory-filter")) button.setAttribute("aria-pressed", String(button.dataset.filter === shown));
    filterEmpty.hidden = items.length > 0 || shown === "ALL";
    filterEmpty.textContent = `No ${SMITH_FILTERS.find(([kind]) => kind === shown)?.[1].toLowerCase() ?? "gear"} to bring`;
    renderFocus(chosen);
    const held = deps.ores();
    oreLine.textContent = REFINE_ORE_ORDER.map(oreId => `${REFINE_ORES[oreId].name} ${held[oreId] ?? 0}`).join(" · ");
    // Where the ore comes from, and the pickaxe to get it with.
    const pickaxe = pickaxeTaken || Boolean(deps.hasPickaxe?.());
    miningText.textContent = pickaxe ? `Mining ${deps.mining?.() ?? 0} · Ore is in the Copper Hills, east of Town` : "Ore is in the Copper Hills, east of Town.";
    pickaxeButton.hidden = pickaxe || !deps.claimPickaxe;
    pickaxeButton.disabled = takingPickaxe;
    // Where the wood comes from, and the hatchet to fell it with.
    const hatchet = hatchetTaken || Boolean(deps.hasHatchet?.());
    hatchetRow.hidden = !deps.claimHatchet && !deps.hasHatchet;
    woodcuttingText.textContent = hatchet ? `Woodcutting ${deps.woodcutting?.() ?? 0} · Wood is in Timberwood, north of the Copper Hills` : "Wood is in Timberwood, north of the Copper Hills.";
    hatchetButton.hidden = hatchet || !deps.claimHatchet;
    hatchetButton.disabled = takingHatchet;
    renderShop();
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

  function heldGear() {
    return new Set([...(deps.heldItems?.() ?? deps.items().map(item => item.itemId)), ...justBought]);
  }

  function shopState() {
    if (!deps.buyGear) return null;
    return [String(deps.gold?.() ?? 0n), deps.masteryLevels?.(), [...heldGear()].filter(gradeShopPrice), deps.bagFull?.(), buyingGear];
  }

  /** One row per line, offering the grade after the best one held. */
  function renderShop() {
    shop.hidden = !deps.buyGear;
    if (!deps.buyGear) return;
    const gold = deps.gold?.() ?? 0n, levels = deps.masteryLevels?.() ?? {}, held = heldGear(), full = deps.bagFull?.() ?? false;
    goldLine.textContent = formatGemAmount(gold);
    shopRows.replaceChildren(...GRADE_SHOP_LINES.map(line => {
      const offer = gradeShopOffer(line, held), price = gradeShopPrice(offer.itemId)!;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "farm-start smith-refine smith-shop-buy";
      button.textContent = buyingGear === offer.itemId ? "Buying…" : offer.owned ? "Owned"
        : !gradeShopOpen(offer.itemId, levels) ? `Need ${gradeShopNeed(offer.itemId)}`
          : gold < BigInt(price) ? `Need ${formatGemAmount(BigInt(price))} Gold` : full ? "Bag Full" : "Buy";
      button.disabled = button.textContent !== "Buy" || buyingGear !== null;
      button.addEventListener("click", () => { void buyGear(offer.itemId, price); });
      return shopRow(offer.itemId, offer.owned ? null : price, button);
    }));
  }

  function shopRow(itemId: GradeItemId, price: number | null, button: HTMLButtonElement) {
    const row = document.createElement("article");
    row.className = "smith-shop-row";
    row.setAttribute("role", "listitem");
    row.dataset.itemId = itemId;
    const armorClass = armorClassOf(itemId), kind = KIND_NAMES[gradeEquipmentKindOf(itemId)!];
    const grade = GEAR_GRADE_NAMES[gradeOf(itemId)!];
    row.innerHTML = `<span class="smith-shop-art" aria-hidden="true">${itemArtMarkup(itemId)}</span>`
      + `<span class="smith-shop-copy"><strong></strong><span class="smith-shop-grade"></span><span class="smith-shop-stat"></span></span>`
      + `<span class="smith-shop-deal"></span>`;
    row.querySelector("strong")!.textContent = nameOf(itemId);
    row.querySelector(".smith-shop-grade")!.textContent = `${grade} · ${armorClass ? `${ARMOR_CLASS_NAMES[armorClass]} ${kind}` : kind}`;
    const [stat] = itemStats(itemId);
    row.querySelector(".smith-shop-stat")!.textContent = [formatEquipmentStat(itemInspectionButtonLabel(stat ?? "")), armorClass ? ARMOR_CLASS_DETAILS[armorClass].perk : ""]
      .filter(Boolean).join(" · ");
    const deal = row.querySelector<HTMLElement>(".smith-shop-deal")!;
    if (price !== null) {
      const cost = document.createElement("span");
      cost.className = "smith-shop-price";
      cost.innerHTML = `${GOLD_COIN}<span></span>`;
      cost.lastElementChild!.textContent = formatGemAmount(BigInt(price));
      cost.setAttribute("aria-label", `${formatGemAmount(BigInt(price))} Gold`);
      deal.append(cost);
    }
    deal.append(button);
    return row;
  }

  async function buyGear(itemId: GradeItemId, price: number) {
    if (buyingGear || !deps.buyGear) return;
    buyingGear = itemId;
    render();
    try {
      const result = await deps.buyGear(itemId, price);
      if (result?.ok) {
        justBought.add(itemId);
        deps.showMessage(`Bought · ${nameOf(itemId)}. Equip it from your bag.`, "#ffd75e");
      } else deps.showMessage(result?.error ?? "Not Connected", "#ff9b91");
    } finally {
      buyingGear = null;
      if (dialog.open) render();
    }
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

  function open() {
    if (!deps.inTown() || dialog.open) return;
    lastResult = null;
    // Each visit goes by the server's word on the pickaxe and the bag: a reset save takes them back.
    pickaxeTaken = false;
    hatchetTaken = false;
    justBought.clear();
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
  hatchetButton.addEventListener("click", async () => {
    if (takingHatchet || !deps.claimHatchet) return;
    takingHatchet = true;
    render();
    try {
      const result = await deps.claimHatchet();
      if (result?.ok) {
        hatchetTaken = true;
        deps.showMessage("The Smith hands you a hatchet. Timberwood is north of the Copper Hills.", "#ffd75e");
      } else deps.showMessage(result?.error ?? "Not Connected", "#ff9b91");
    } finally {
      takingHatchet = false;
      if (dialog.open) render();
    }
  });
  staffButton.addEventListener("click", async () => {
    if (takingStaff || !deps.claimStarterStaff) return;
    takingStaff = true;
    render();
    try {
      const result = await deps.claimStarterStaff();
      if (result?.ok) deps.showMessage("The Smith hands you a Starter Staff. Equip it from your bag.", "#ffd75e");
      else deps.showMessage(result?.error ?? "Not Connected", "#ff9b91");
    } finally {
      takingStaff = false;
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
    claimStarterStaff?: () => Promise<Result>;
    mining?: () => number;
    hasHatchet?: () => boolean;
    claimHatchet?: () => Promise<Result>;
    woodcutting?: () => number;
    itemRefine?: (itemId: string, copyId?: bigint) => number;
    itemUpgradeLevel?: (itemId: string) => number;
    ores?: () => Readonly<Partial<Record<OreId, number>>>;
    refineItem?: (itemId: string, copyId: bigint, expectedLevel: number) => Promise<Result>;
    researchInPlay?: () => { refineLuck?: number };
    equipmentCopies?: () => readonly { id: bigint; itemId: string }[];
    setOnRefineResult?: (callback: ((result: RefineResult) => void) | null) => void;
    gold?: () => bigint;
    weaponMastery?: () => Readonly<Record<WeaponSchool, bigint>>;
    buyGradeGear?: (itemId: string, expectedPrice: number) => Promise<Result>;
    activeItemUpgrades?: () => readonly { itemId: string }[];
    inventorySlotsUnlocked?: () => number;
    research?: () => { inventorySlots?: number };
  } | null | undefined;
  inventory: { itemIds: string[]; equippedHead: string; equippedChest: string; equippedFeet?: string; equippedRightHand: string; equippedLeftHand: string };
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
    refineLuck: () => deps.coop()?.researchInPlay?.()?.refineLuck ?? 0,
    hasPickaxe: () => deps.coop()?.hasPickaxe?.() ?? false,
    claimPickaxe: async () => deps.coop()?.claimPickaxe?.() ?? { ok: false, error: "Not Connected" },
    hasStarterStaff: () => inventory.itemIds.includes(STARTER_STAFF),
    claimStarterStaff: async () => deps.coop()?.claimStarterStaff?.() ?? { ok: false, error: "Not Connected" },
    mining: () => deps.coop()?.mining?.() ?? 0,
    hasHatchet: () => deps.coop()?.hasHatchet?.() ?? false,
    claimHatchet: async () => deps.coop()?.claimHatchet?.() ?? { ok: false, error: "Not Connected" },
    woodcutting: () => deps.coop()?.woodcutting?.() ?? 0,
    gold: () => deps.coop()?.gold?.() ?? 0n,
    masteryLevels: () => masteryLevels(deps.coop()?.weaponMastery?.() ?? {}),
    heldItems: () => [...inventory.itemIds, ...(deps.coop()?.activeItemUpgrades?.() ?? []).map(active => active.itemId)],
    // The bag as the server counts it (freeBagSlots): items, kept copies, ore stacks.
    bagFull: () => {
      const coop = deps.coop(), capacity = bagSlotCapacity(coop?.inventorySlotsUnlocked?.() ?? 0, coop?.research?.().inventorySlots ?? 0);
      const equipped = [inventory.equippedHead, inventory.equippedChest, inventory.equippedFeet ?? "", inventory.equippedRightHand, inventory.equippedLeftHand];
      return bagSlotsWithOres({ owned: inventory.itemIds, equipped, extraCopies: coop?.equipmentCopies?.().length ?? 0, ores: coop?.ores?.() ?? {}, capacity }) >= capacity;
    },
    buyGear: async (itemId, expectedPrice) => deps.coop()?.buyGradeGear?.(itemId, expectedPrice) ?? { ok: false, error: "Not Connected" },
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
