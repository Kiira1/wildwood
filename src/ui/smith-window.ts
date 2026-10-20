import { itemDefinition, itemDisplayName, itemStats, type EquipmentSlot } from "../../shared/items";
import {
  REFINE_MAX, REFINE_ORES, isRefinableItem, refineCost, refineSafeLimit, refineSuccessChance, type OreId,
} from "../../shared/refine";
import { itemArtMarkup } from "../game/item-presentation";
import { itemInspectionButtonLabel } from "./item-inspection-controller";
import { formatEquipmentStat } from "./equipment-stat-format";
import { refineStars } from "./refine-badge";
import { REFINE_ORE_ORDER } from "../../shared/ore-bag";
import { itemTier } from "../../shared/item-tier";
import type { GradeItemId } from "../../shared/grade-equipment";
import type { GearGrade } from "../../shared/gear-grades";
import {
  GRADE_SHOP_LINES, gradeShopItemId, gradeShopLineKey, gradeShopOffer, gradeShopOpen, gradeShopPrice, masteryLevels, type MasteryLevels,
} from "../../shared/grade-shop";
import { weaponSchool as schoolOfWeapon, type WeaponSchool } from "../../shared/weapon-mastery";
import { formatGemAmount } from "./number-format";
import {
  bagFullFor, craftDepsFor, createCraftSection, gradeItemRow, gradeStepperElement, heldItemsFor, masteryNeed, nextNeed, offerButton, offerLine, ownedRow,
  type CraftCoop, type CraftSectionDeps,
} from "./craft-section";
import { mountToolSection, toolDepsFor, type ToolSectionDeps } from "./tool-section";
import {
  gearComparison, gradeShortName, schoolLines, schoolWeaponName, upgradeAllPlan, wornInSlot, type UpgradePlan, type WornLoadout,
} from "./smith-upgrades";

type Result = { ok: boolean; error?: string } | undefined;
type RefineResult = { itemId: string; copyId: bigint; fromLevel: number; toLevel: number; succeeded: boolean };
/** One copy of an item the player holds: copy id 0 is the first copy, the one a slot holds. */
export type SmithItem = { itemId: string; copyId: bigint; equipped: boolean };

const key = (item: { itemId: string; copyId: bigint }) => `${item.itemId}:${item.copyId}`;
/** The bag's filters for the gear the Smith works on. */
const SMITH_FILTERS = [["ALL", "All"], ["HAND", "Weapons"], ["CHEST", "Armor"], ["HEAD", "Helmets"], ["FEET", "Boots"]] as const;
const nameOf = (itemId: string) => itemInspectionButtonLabel(itemDisplayName(itemId));
// The HUD's gold coin, beside every price in gold.
const GOLD_COIN = `<svg class="smith-coin" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="#e3b23c" stroke="#7a4f12" stroke-width="1.5"/><circle cx="10" cy="10" r="5.5" fill="none" stroke="#a8741d" stroke-width="1.2"/></svg>`;
// Refine Luck moves the odds by fractions of a percent, so they keep their decimals (2.2%, 0.031%).
const percent = (chance: number) => {
  const value = chance * 100;
  return `${Number(value.toFixed(value >= 10 ? 1 : value >= 1 ? 2 : 3))}%`;
};

/** The Smith's three views, and which lines the gear view lists; both kept on the device. */
type SmithView = "gear" | "refine" | "tools";
type GearShown = "yours" | "all";
const VIEW_STORE = "wildstat.smithView", SHOWN_STORE = "wildstat.smithGearShown";
const VIEW_NAMES: Readonly<Record<SmithView, string>> = { gear: "Gear", refine: "Refine", tools: "Tools" };
function stored(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* this visit only */ }
}

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
  /** The Mining (shared/mining.ts) and Woodcutting (shared/woodcutting.ts) stats, beside where the ore and wood are. */
  mining?: () => number;
  woodcutting?: () => number;
  /** The gear shop: graded gear for gold, opened by Mastery (shared/grade-shop.ts); the server decides (buy_grade_gear). */
  gold?: () => bigint;
  masteryLevels?: () => MasteryLevels;
  /** Every item held, worn or on the Upgrade Bench; crafting's or the bag's own when left out. */
  heldItems?: () => readonly string[];
  bagFull?: () => boolean;
  buyGear?: (itemId: string, expectedPrice: number) => Promise<Result>;
  /** Smithing, Fletching and Enchanting: every line crafted here, offered on the shop's rows (craft-section.ts). */
  craft?: CraftSectionDeps;
  tools?: ToolSectionDeps;
  /** What the player wears, for "vs Now" and Upgrade All; read from the worn items when left out. */
  worn?: () => WornLoadout;
  /** Puts on a piece just bought, as the bag does; false when it could not. */
  equip?: (itemId: string) => boolean | Promise<boolean>;
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
    + `<section class="smith-view smith-tools-view" data-view="tools">`
    + `<div class="smith-mining"><span class="smith-mining-text"></span></div>`
    + `<div class="smith-mining"><span class="smith-woodcutting-text"></span></div>`
    + `</section>`
    + `<section class="smith-view smith-gear-view" data-view="gear">`
    + `<section class="smith-shop" aria-labelledby="smithShopTitle">`
    + `<div class="smith-upgrade-all"><button type="button" class="farm-start smith-upgrade-all-button"><span class="smith-upgrade-all-title"></span><span class="smith-upgrade-all-sub"></span></button>`
    + `<ul class="smith-upgrade-all-picks" aria-label="Upgrade All buys"></ul></div>`
    + `<div class="smith-shop-bar"><div class="inventory-filters smith-shown" role="group" aria-label="Lines shown"></div>`
    + `<span class="smith-gold" aria-label="Your gold">${GOLD_COIN}<strong></strong></span></div>`
    + `<div class="smith-shop-head"><h3 id="smithShopTitle">Gear</h3></div>`
    + `<div class="smith-shop-rows" role="list" aria-label="Gear to buy or craft"></div></section>`
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
  const shop = dialog.querySelector<HTMLElement>(".smith-shop")!;
  const goldLine = dialog.querySelector<HTMLElement>(".smith-gold strong")!;
  const shopRows = dialog.querySelector<HTMLElement>(".smith-shop-rows")!;
  const shopTitle = dialog.querySelector<HTMLElement>("#smithShopTitle")!;
  const viewBar = dialog.querySelector<HTMLElement>(".smith-views")!, shownBar = dialog.querySelector<HTMLElement>(".smith-shown")!;
  const itemsCount = dialog.querySelector<HTMLElement>(".smith-items-count")!;
  const upgradeButton = dialog.querySelector<HTMLButtonElement>(".smith-upgrade-all-button")!;
  const upgradeTitle = dialog.querySelector<HTMLElement>(".smith-upgrade-all-title")!, upgradeSub = dialog.querySelector<HTMLElement>(".smith-upgrade-all-sub")!;
  const upgradePicks = dialog.querySelector<HTMLElement>(".smith-upgrade-all-picks")!;
  // The three crafts' levels head the list; every row takes a Craft line by the craft that makes it.
  const crafts = deps.craft ? createCraftSection(deps.craft, { onChange: () => { if (dialog.open) render(); } }) : null;
  if (crafts) shopTitle.parentElement!.before(crafts.element);
  const tools = mountToolSection(dialog, deps.tools, () => { if (dialog.open) render(); });
  // Gear for the casual player first; refining and tools a tap away.
  const views = ([
    ["gear", Boolean(deps.buyGear || deps.craft)], ["refine", true],
    ["tools", Boolean(deps.tools || deps.mining || deps.woodcutting)],
  ] as const).filter(([, shown]) => shown).map(([view]) => view as SmithView);
  let view: SmithView = views.find(each => each === stored(VIEW_STORE)) ?? views[0];
  let gearShown: GearShown = stored(SHOWN_STORE) === "all" ? "all" : "yours";
  viewBar.parentElement!.hidden = views.length < 2;
  for (const each of views) {
    const button = pillButton(VIEW_NAMES[each], () => { if (view !== each) { view = each; store(VIEW_STORE, each); render(); } });
    button.dataset.view = each;
    // A dot on Gear while Upgrade All has something to buy.
    if (each === "gear") button.append(Object.assign(document.createElement("span"), { className: "smith-upgrade-dot", hidden: true }));
    viewBar.append(button);
  }
  for (const [each, label] of [["yours", "Yours"], ["all", "All Gear"]] as const) {
    const button = pillButton(label, () => { if (gearShown !== each) { gearShown = each; store(SHOWN_STORE, each); render(); } });
    button.dataset.shown = each;
    shownBar.append(button);
  }
  upgradeButton.addEventListener("click", () => { void upgradeAll(); });
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
  /** Upgrade All on its way: pieces bought so far, of how many. */
  let upgrading: { done: number; of: number } | null = null;
  let lastResult: { text: string; good: boolean } | null = null;
  let renderedState = "";
  /** The piece being bought, and the ones bought here before the server's row arrives. */
  let buyingGear: string | null = null;
  const justBought = new Set<string>();
  /** The grade picked to buy on each line; the best the gold covers until the player steps. */
  const shopPicked = new Map<string, GearGrade>();

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

  function compare(itemId: GradeItemId, worn: WornLoadout) {
    const current = wornInSlot(worn, itemId);
    return gearComparison(itemId, worn, { tier: deps.slotTier(itemId), wornRefine: current ? deps.refineLevel(current, 0n) : 0 });
  }

  /** What Upgrade All would buy now. */
  function plan(): UpgradePlan {
    const worn = wornNow();
    return upgradeAllPlan({
      lines: schoolLines(school(worn)), held: heldGear(), levels: deps.masteryLevels?.() ?? {}, gold: Number(deps.gold?.() ?? 0n),
      beats: itemId => compare(itemId, worn).delta > 0,
    });
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
      view, gearShown, upgrading, wornNow(), shown, selected, refining, lastResult,
      deps.ores(), deps.mining?.(), deps.woodcutting?.(), shopState(),
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
    return new Set([...(deps.heldItems?.() ?? deps.craft?.heldItems() ?? deps.items().map(item => item.itemId)), ...justBought, ...(crafts?.crafted() ?? [])]);
  }

  function shopState() {
    if (!deps.buyGear && !crafts) return null;
    return [String(deps.gold?.() ?? 0n), deps.masteryLevels?.(), [...heldGear()].filter(gradeShopPrice), deps.bagFull?.(), buyingGear, [...shopPicked], crafts?.state(),
      [...new Set(GRADE_SHOP_LINES.map(line => deps.slotTier(gradeShopItemId(line, "crude"))))]];
  }

  /** The big button: what Upgrade All costs and buys, or why it waits. */
  function renderUpgradeAll(next: UpgradePlan) {
    const busy = buyingGear !== null || upgrading !== null, full = Boolean(deps.bagFull?.());
    upgradeButton.disabled = busy || full || !next.picks.length;
    upgradeTitle.textContent = upgrading ? `Upgrading… ${upgrading.done} / ${upgrading.of}` : full && next.picks.length ? "Bag Full"
      : next.picks.length ? `Upgrade All · ${formatGemAmount(BigInt(next.total))} Gold` : "Nothing To Upgrade Yet";
    upgradeSub.textContent = upgrading ? "" : full && next.picks.length ? "Free a Bag Space First"
      : next.picks.length ? `Buys and Equips ${next.picks.length === 1 ? "1 Piece" : `${next.picks.length} Pieces`}` : next.next;
    upgradeSub.hidden = !upgradeSub.textContent;
    upgradePicks.replaceChildren(...next.picks.map(pick => Object.assign(document.createElement("li"), { textContent: gradeShortName(pick.itemId) })));
    upgradePicks.hidden = !next.picks.length || upgrading !== null;
    const dot = viewBar.querySelector<HTMLElement>(".smith-upgrade-dot");
    if (dot) dot.hidden = !next.picks.length || view === "gear";
  }

  /**
   * One row per line, offering any grade Mastery opens above the best one held: a Buy line for gold with a grade
   * stepper (the best the gold covers to start, else the highest open), and a Craft line by the craft that makes it
   * (any open grade, picked on the line). Without a shop, every line's Craft line, each row showing the grade picked.
   */
  function renderShop() {
    shop.hidden = !deps.buyGear && !crafts;
    if (shop.hidden) return;
    goldLine.parentElement!.parentElement!.hidden = !deps.buyGear;
    upgradeButton.parentElement!.hidden = !deps.buyGear;
    goldLine.textContent = formatGemAmount(deps.gold?.() ?? 0n);
    const held = heldGear(), levels = deps.masteryLevels?.() ?? deps.craft?.masteryLevels() ?? {}, worn = wornNow();
    if (deps.buyGear) renderUpgradeAll(plan());
    for (const button of shownBar.querySelectorAll<HTMLButtonElement>("[data-shown]")) button.setAttribute("aria-pressed", String(button.dataset.shown === gearShown));
    // Yours: the weapon in hand's lines, as Upgrade All buys them. All Gear: every line.
    const yours = schoolLines(school(worn)).map(gradeShopLineKey);
    const lines = !deps.buyGear || gearShown === "all" ? GRADE_SHOP_LINES : GRADE_SHOP_LINES.filter(line => yours.includes(gradeShopLineKey(line)));
    shopTitle.textContent = !deps.buyGear ? "Gear" : gearShown === "all" ? "All Gear" : `For Your ${schoolWeaponName(school(worn))}`;
    shopRows.replaceChildren(...lines.map(line => {
      const made = crafts?.craftLine(line, held) ?? null;
      if (!deps.buyGear) {
        // The craft line says what the next grade needs.
        const { row, deal } = gradeItemRow(made!.itemId);
        deal.append(made!.line);
        return row;
      }
      const offer = gradeShopOffer(line, held, levels, Number(deps.gold?.() ?? 0n)), choice = shopPicked.get(gradeShopLineKey(line));
      const grade = choice && offer.grades.includes(choice) ? choice : offer.grade, itemId = gradeShopItemId(line, grade);
      // An open offer says what comes next; a locked one, the Mastery it waits for.
      const { row, deal } = offer.owned ? ownedRow(itemId)
        : gradeItemRow(itemId, 0, offer.open ? nextNeed(offer.next, next => masteryNeed(next, levels)) : masteryNeed(itemId, levels));
      if (!offer.owned) row.querySelector(".smith-shop-stat")!.after(comparisonTag(itemId, worn));
      const stepper = offer.open ? gradeStepperElement(offer.grades, grade, {
        label: "Grade to buy", busy: buyingGear !== null, onPick: to => { shopPicked.set(gradeShopLineKey(line), to); render(); },
      }) : null;
      if (!offer.owned) deal.append(buyLine(itemId, levels, stepper));
      if (made) deal.append(made.line);
      return row;
    }));
  }

  /** "+12% Damage vs Now": what the piece changes against what is worn in its slot. */
  function comparisonTag(itemId: GradeItemId, worn: WornLoadout) {
    const { delta, text } = compare(itemId, worn);
    const tag = document.createElement("span");
    tag.className = `smith-compare ${delta > 0 ? "is-better" : delta < 0 ? "is-worse" : "is-same"}`;
    tag.textContent = text;
    return tag;
  }

  /** The price in gold and a Buy button that says why it waits: Mastery, then gold, then the bag. */
  function buyLine(itemId: GradeItemId, levels: MasteryLevels, stepper: HTMLElement | null) {
    const price = gradeShopPrice(itemId)!, gold = deps.gold?.() ?? 0n;
    const text = buyingGear === itemId ? "Buying…" : !gradeShopOpen(itemId, levels) ? "Locked"
      : gold < BigInt(price) ? "Need Gold" : deps.bagFull?.() ? "Bag Full" : "Buy";
    const cost = document.createElement("span");
    cost.className = "smith-shop-price";
    cost.innerHTML = `${GOLD_COIN}<span></span>`;
    cost.lastElementChild!.textContent = formatGemAmount(BigInt(price));
    cost.setAttribute("aria-label", `${formatGemAmount(BigInt(price))} Gold`);
    const terms: Node[] = stepper ? [stepper, cost] : [cost];
    const line = offerLine(terms, offerButton(text, text === "Buy" && buyingGear === null && upgrading === null, () => { void buyGear(itemId, price); }));
    // Stacked like a craft line: the grade, then its price.
    if (stepper) line.classList.add("buy-offer");
    return line;
  }

  /**
   * Upgrade All: each piece of the plan bought in turn (buy_grade_gear) and put on as the bag would, so a bag with one
   * free space is enough. A refusal stops it there and says how far it got.
   */
  async function upgradeAll() {
    const picks = plan().picks;
    if (!picks.length || buyingGear || upgrading || !deps.buyGear) return;
    const progress = { done: 0, of: picks.length };
    upgrading = progress;
    const bought: string[] = [];
    let unequipped = 0, error = "";
    try {
      for (const pick of picks) {
        buyingGear = pick.itemId;
        render();
        const result = await deps.buyGear(pick.itemId, pick.price);
        if (!result?.ok) { error = result?.error ?? "Not Connected"; break; }
        justBought.add(pick.itemId);
        bought.push(gradeShortName(pick.itemId));
        progress.done = bought.length;
        if (!(await deps.equip?.(pick.itemId))) unequipped++;
      }
    } finally {
      buyingGear = null;
      upgrading = null;
      if (dialog.open) render();
    }
    if (error) deps.showMessage(bought.length ? `Bought ${bought.length} of ${picks.length} · ${error}` : error, "#ff9b91");
    else deps.showMessage(`Upgraded · ${bought.join(", ")}${unequipped ? `. Equip ${unequipped === 1 ? "it" : "them"} from your bag.` : ""}`, "#ffd75e");
  }

  async function buyGear(itemId: GradeItemId, price: number) {
    if (buyingGear || upgrading || !deps.buyGear) return;
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
    // Each visit goes by the server's word on the bag.
    justBought.clear();
    shopPicked.clear();
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
    /** Whether Upgrade All has something to buy: the dot on the way to the Smith. */
    upgradeReady: () => Boolean(deps.buyGear) && plan().picks.length > 0,
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

/** The Smith as main.ts uses it: refining through the coop session, the bag's copies, and each try's verdict. */
export function createSmithRuntime(deps: {
  coop: () => (CraftCoop & {
    mining?: () => number;
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
  }) | null | undefined;
  inventory: { itemIds: string[]; equippedHead: string; equippedChest: string; equippedFeet?: string; equippedRightHand: string; equippedLeftHand: string };
  showMessage: (text: string, color: string) => void;
  clearInput?: () => void;
  inTown: () => boolean;
  /** The bag's own equip (main.ts's move), for Upgrade All. */
  equip?: (itemId: string, destination: EquipmentSlot) => boolean;
  /** Where the dot goes while Upgrade All has something to buy: the Town button. */
  noticeHost?: HTMLElement | null;
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
    gold: () => deps.coop()?.gold?.() ?? 0n,
    masteryLevels: () => masteryLevels(deps.coop()?.weaponMastery?.() ?? {}),
    heldItems: () => heldItemsFor(deps.coop(), inventory),
    bagFull: () => bagFullFor(deps.coop(), inventory),
    buyGear: async (itemId, expectedPrice) => deps.coop()?.buyGradeGear?.(itemId, expectedPrice) ?? { ok: false, error: "Not Connected" },
    craft: craftDepsFor(deps.coop, inventory, deps.showMessage),
    tools: toolDepsFor(deps.coop, deps.showMessage),
    worn: () => inventory,
    equip: deps.equip ? itemId => equipWhenHeld(inventory, itemId, deps.equip!) : undefined,
  });
  const notice = smithNotice(deps.noticeHost === undefined ? document.getElementById("techTreeBtn") : deps.noticeHost);
  let listening = false;
  return {
    ...smith,
    /** Shows or hides the dot; the session's refresh calls it as rows change. */
    refreshNotice() { if (notice) notice.hidden = !smith.upgradeReady(); },
    open() {
      // Each try's verdict arrives as a row; listen from the first visit the session is up for.
      const coop = deps.coop();
      if (!listening && coop?.setOnRefineResult) { coop.setOnRefineResult(result => smith.showResult(result)); listening = true; }
      smith.open();
    },
  };
}

const EQUIP_WAIT_MS = 5_000;

/** A bought piece reaches the bag with the server's row; it goes on once it is there, as the bag puts it on. */
export async function equipWhenHeld(inventory: { itemIds: string[] }, itemId: string, equip: (itemId: string, destination: EquipmentSlot) => boolean,
  wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let waited = 0; !inventory.itemIds.includes(itemId); waited += 100) {
    if (waited >= EQUIP_WAIT_MS) return false;
    await wait(100);
  }
  const slot = itemDefinition(itemId)?.slot;
  return slot ? equip(itemId, slot === "HAND" ? "RIGHT_HAND" : slot) : false;
}

/** The Town button's red dot, as Tech Tree research shows, for upgrades waiting at the Smith. */
export function smithNotice(host: HTMLElement | null) {
  if (!host) return null;
  const dot = document.createElement("span");
  dot.className = "tech-tree-notice smith-upgrade-notice";
  dot.setAttribute("aria-label", "Upgrades at the Smith");
  dot.hidden = true;
  host.append(dot);
  return dot;
}
