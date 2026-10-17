import { STARTER_STAFF, itemDefinition, itemDisplayName, itemStats } from "../../shared/items";
import {
  REFINE_MAX, REFINE_ORES, isRefinableItem, refineCost, refineSafeLimit, refineSuccessChance, type OreId,
} from "../../shared/refine";
import { itemArtMarkup } from "../game/item-presentation";
import { itemInspectionButtonLabel } from "./item-inspection-controller";
import { formatEquipmentStat } from "./equipment-stat-format";
import { refineStars } from "./refine-badge";
import { ORE_ORDER } from "../../shared/ore-bag";
import { CARDS, cardDefinition, cardFitsItem, type CardSlot } from "../../shared/cards";
import { CARD_SLOT_NAMES, cardEffectText, cardName } from "../../shared/card-text";
import { byMapThenRarity, cardTile } from "./cards-tab";
import { cardPortrait } from "./card-portrait";
import { itemTier } from "../../shared/item-tier";

type Result = { ok: boolean; error?: string } | undefined;
type GearSlots = { slots: number; cards: readonly string[] };
type RefineResult = { itemId: string; copyId: bigint; fromLevel: number; toLevel: number; succeeded: boolean };
/** One copy of an item the player holds: copy id 0 is the first copy, the one a slot holds. */
export type SmithItem = { itemId: string; copyId: bigint; equipped: boolean };

const key = (item: { itemId: string; copyId: bigint }) => `${item.itemId}:${item.copyId}`;
/** The bag's filters for the gear the Smith works on (boots are not refined). */
const SMITH_FILTERS = [["ALL", "All"], ["HAND", "Weapons"], ["CHEST", "Armor"], ["HEAD", "Helmets"]] as const;
const nameOf = (itemId: string) => itemInspectionButtonLabel(itemDisplayName(itemId));
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
  /** The free Starter Staff he hands out, as he does the pickaxe. */
  hasStarterStaff?: () => boolean;
  claimStarterStaff?: () => Promise<Result>;
  /** Cards (shared/cards.ts): those held, a copy's slots, and slotting one in. Without them there is no Cards tab. */
  cards?: () => Readonly<Record<string, number>>;
  gearSlots?: (itemId: string, copyId: bigint) => GearSlots;
  slotCard?: (itemId: string, copyId: bigint, cardId: string, expectedCards: number) => Promise<Result>;
  /** Lifts a slotted card back out for Starshards; without it the slots show no Remove. */
  removeCard?: (itemId: string, copyId: bigint, index: number, expectedCards: number) => Promise<Result>;
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "farm-sheet quest-sheet smith-sheet";
  dialog.setAttribute("aria-labelledby", "smithTitle");
  dialog.innerHTML = `<header class="farm-header"><h2 id="smithTitle" class="window-banner"><span>The Smith</span></h2></header>`
    + `<div class="quest-body"><div class="inventory-tabs smith-tabs" role="tablist" aria-label="The Smith">`
    + `<button type="button" class="inventory-tab" role="tab" data-tab="refine">Refine</button><button type="button" class="inventory-tab" role="tab" data-tab="cards">Cards</button></div>`
    + `<p class="farm-map smith-intro"></p>`
    + `<section class="smith-focus" aria-live="polite"></section>`
    + `<p class="smith-ores" aria-label="Your ores"></p>`
    + `<div class="smith-mining"><span class="smith-mining-text"></span><button type="button" class="farm-start smith-refine smith-pickaxe">Take a Pickaxe</button></div>`
    + `<div class="smith-mining smith-staff-row"><span class="smith-mining-text">Starter Staff · Casts bolts that burst on a pack</span><button type="button" class="farm-start smith-refine smith-staff">Take a Staff</button></div>`
    + `<section class="smith-cards" aria-label="Your cards that fit"><p class="smith-empty smith-cards-note"></p><div class="inventory-items smith-card-grid"></div></section>`
    + `<div class="inventory-filters smith-filters" role="group" aria-label="Show gear"></div>`
    + `<p class="smith-empty smith-filter-empty" hidden></p>`
    + `<div class="smith-items" role="listbox" aria-label="Your gear"></div></div>`
    + `<footer class="farm-footer"><div class="farm-actions"><button type="button" class="window-back-button">Back</button></div></footer>`;
  document.body.append(dialog);
  const focus = dialog.querySelector<HTMLElement>(".smith-focus")!;
  const oreLine = dialog.querySelector<HTMLElement>(".smith-ores")!;
  const list = dialog.querySelector<HTMLElement>(".smith-items")!;
  const back = dialog.querySelector<HTMLButtonElement>(".window-back-button")!;
  const miningText = dialog.querySelector<HTMLElement>(".smith-mining-text")!;
  const pickaxeButton = dialog.querySelector<HTMLButtonElement>(".smith-pickaxe")!;
  const staffRow = dialog.querySelector<HTMLElement>(".smith-staff-row")!;
  const staffButton = dialog.querySelector<HTMLButtonElement>(".smith-staff")!;
  const intro = dialog.querySelector<HTMLElement>(".smith-intro")!;
  const mining = dialog.querySelector<HTMLElement>(".smith-mining")!;
  const cardsSection = dialog.querySelector<HTMLElement>(".smith-cards")!;
  const cardGrid = dialog.querySelector<HTMLElement>(".smith-card-grid")!;
  const cardsNote = dialog.querySelector<HTMLElement>(".smith-cards-note")!;
  const tabButtons = [...dialog.querySelectorAll<HTMLButtonElement>(".smith-tabs .inventory-tab")];
  const filterBar = dialog.querySelector<HTMLElement>(".smith-filters")!;
  const filterEmpty = dialog.querySelector<HTMLElement>(".smith-filter-empty")!;
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
  const canSlot = Boolean(deps.cards && deps.gearSlots && deps.slotCard);
  if (!canSlot) dialog.querySelector(".smith-tabs")!.remove();
  let tab: "refine" | "cards" = "refine";
  let pickedCard: string | null = null;
  let slotting = false;
  /** The slot whose Remove was tapped once: the next tap on it removes the card. */
  let armedRemoval: string | null = null;
  let selected: string | null = null;
  let refining = false;
  /** Taken here and on its way: the button goes before the server's row arrives. */
  let pickaxeTaken = false, takingPickaxe = false, takingStaff = false;
  let lastResult: { text: string; good: boolean } | null = null;
  let renderedState = "";

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

  const slotsOf = (item: SmithItem) => deps.gearSlots?.(item.itemId, item.copyId) ?? { slots: 0, cards: [] };

  /** The Cards tab's focus: the copy's slots, and the picked card with its effects and the button to slot it. */
  function renderSlots(item: SmithItem | undefined) {
    if (!item) {
      focus.innerHTML = `<p class="smith-empty">Bring the Smith a weapon, helmet or armor to slot cards into.</p>`;
      return;
    }
    const { slots, cards } = slotsOf(item);
    focus.replaceChildren(itemHead(item, `Card Slots ${cards.length} / ${slots}`));
    const row = document.createElement("div");
    row.className = "smith-slot-row";
    for (let index = 0; index < slots; index++) {
      const card = cardDefinition(cards[index]);
      const chip = document.createElement("div");
      chip.className = card ? `smith-slot is-filled is-${card.rarity}` : "smith-slot";
      if (card) {
        const art = document.createElement("img");
        art.alt = "";
        void cardPortrait(card.id).then(source => { if (source) art.src = source; });
        const name = document.createElement("span");
        name.textContent = cardName(card);
        chip.append(art, name);
        if (deps.removeCard) chip.append(removeButton(item, index, cards.length));
      } else chip.textContent = "Empty Slot";
      row.append(chip);
    }
    focus.append(row);
    const card = cardDefinition(pickedCard);
    if (card && cards.length < slots) {
      const effects = document.createElement("ul");
      effects.className = "smith-card-effects";
      for (const effect of card.effects) {
        const line = document.createElement("li");
        line.textContent = cardEffectText(effect);
        if (effect.value < 0) line.className = "is-cost";
        effects.append(line);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "farm-start smith-refine";
      button.textContent = slotting ? "Slotting…" : `Slot ${cardName(card)}`;
      button.disabled = slotting;
      button.addEventListener("click", () => { void slot(item, card.id, cards.length); });
      const warning = document.createElement("p");
      warning.className = "smith-empty";
      warning.textContent = deps.removeCard ? "Cards come back out free here, and return to your cards if the gear is destroyed." : "A slotted card stays in for good.";
      focus.append(effects, button, warning);
    }
    appendOutcome();
  }

  /** The cards held that fit the chosen copy; one is picked to slot, none once every slot is full. */
  function renderCardList(item: SmithItem | undefined) {
    cardsSection.hidden = tab !== "cards";
    if (tab !== "cards") return;
    const held = deps.cards?.() ?? {};
    const fitting = item ? CARDS.filter(card => (held[card.id] ?? 0) > 0 && cardFitsItem(card.id, item.itemId)).sort(byMapThenRarity) : [];
    const { slots, cards } = item ? slotsOf(item) : { slots: 0, cards: [] };
    const full = cards.length >= slots;
    if (!fitting.some(card => card.id === pickedCard) || full) pickedCard = null;
    cardGrid.replaceChildren(...(full ? [] : fitting).map(card => {
      const tile = cardTile(card, held[card.id] ?? 0, () => { pickedCard = card.id; lastResult = null; render(); });
      tile.setAttribute("aria-selected", String(card.id === pickedCard));
      tile.disabled = slotting;
      return tile;
    }));
    const slotName = CARD_SLOT_NAMES[(itemDefinition(item?.itemId ?? "")?.slot ?? "HAND") as CardSlot];
    cardsNote.textContent = !item ? "" : slots === 0 ? "This gear has no card slots." : full ? "Every slot in this gear is full."
      : fitting.length ? "Pick a card to slot it." : `No ${slotName} cards yet. Cards drop rarely from enemies and bosses.`;
    cardsNote.hidden = !item;
  }

  function render() {
    const items = choices();
    if (!selected || !items.some(item => key(item) === selected)) selected = items[0] ? key(items[0]) : null;
    const chosen = items.find(item => key(item) === selected);
    // Presence updates also refresh open windows. Keep focus and buttons in place until this window changes.
    const state = JSON.stringify([
      tab, shown, selected, pickedCard, slotting, armedRemoval, refining, lastResult, pickaxeTaken, takingPickaxe, takingStaff, deps.hasStarterStaff?.(),
      deps.ores(), deps.hasPickaxe?.(), deps.mining?.(), deps.cards?.(),
      items.map(item => [key(item), item.equipped, deps.refineLevel(item.itemId, item.copyId), deps.slotTier(item.itemId), slotsOf(item)]),
    ]);
    if (state === renderedState) return;
    renderedState = state;
    for (const button of tabButtons) {
      const active = button.dataset.tab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      button.disabled = slotting;
    }
    intro.textContent = tab === "cards" ? "Slot cards into gear. Each card adds its effects to the gear it is in."
      : "Refine gear with ore. Safe up to its limit; past it a try can fail, and a fail costs only the ore.";
    oreLine.hidden = mining.hidden = tab === "cards";
    // Shown until the bag holds one; a thrown-away staff can be taken again.
    staffRow.hidden = tab === "cards" || !deps.claimStarterStaff || Boolean(deps.hasStarterStaff?.());
    staffButton.disabled = takingStaff;
    for (const button of filterBar.querySelectorAll<HTMLButtonElement>(".inventory-filter")) button.setAttribute("aria-pressed", String(button.dataset.filter === shown));
    filterEmpty.hidden = items.length > 0 || shown === "ALL";
    filterEmpty.textContent = `No ${SMITH_FILTERS.find(([kind]) => kind === shown)?.[1].toLowerCase() ?? "gear"} to bring`;
    renderCardList(chosen);
    if (tab === "cards") renderSlots(chosen);
    else renderFocus(chosen);
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
      option.disabled = slotting;
      option.setAttribute("role", "option");
      const isSelected = key(item) === selected, level = deps.refineLevel(item.itemId, item.copyId);
      option.setAttribute("aria-selected", String(isSelected));
      option.setAttribute("aria-label", `${nameOf(item.itemId)} ${refineStars(level)}${item.equipped ? ", worn" : ""}`.trim());
      option.innerHTML = `<span class="smith-choice-art">${itemArtMarkup(item.itemId)}</span>`
        + (level > 0 ? `<span class="refine-badge">${refineStars(level)}</span>` : "")
        + (item.equipped ? `<span class="smith-worn">Worn</span>` : "");
      // On the Cards tab each copy shows its slots: ◆ holds a card, ◇ is open.
      if (tab === "cards") {
        const { slots, cards } = slotsOf(item);
        const pips = document.createElement("span");
        pips.className = "smith-slot-pips";
        pips.textContent = "◆".repeat(Math.min(cards.length, slots)) + "◇".repeat(Math.max(0, slots - cards.length));
        option.append(pips);
      }
      option.addEventListener("click", () => {
        if (slotting) return;
        selected = key(item); lastResult = null; pickedCard = null; render();
      });
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
      : { text: "It failed. Nothing lost but the ore.", good: false };
    deps.showMessage(result.succeeded ? `Refined · ${name}` : `Refine Failed · ${name}`, result.succeeded ? "#ffd75e" : "#ff9b91");
    if (dialog.open) render();
  }

  /** Remove on a slotted card: a first tap arms it, a second takes it out, free. */
  function removeButton(item: SmithItem, index: number, expectedCards: number) {
    const slotKey = `${key(item)}:${index}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "smith-slot-remove";
    const armed = armedRemoval === slotKey;
    button.textContent = slotting ? "Working…" : armed ? "Confirm Remove" : "Remove";
    button.classList.toggle("is-armed", armed);
    button.disabled = slotting;
    button.addEventListener("click", () => {
      if (armedRemoval !== slotKey) { armedRemoval = slotKey; render(); return; }
      armedRemoval = null;
      void removeSlotted(item, index, expectedCards);
    });
    return button;
  }

  async function removeSlotted(item: SmithItem, index: number, expectedCards: number) {
    const card = cardDefinition(slotsOf(item).cards[index]);
    if (slotting || !card || !deps.removeCard) return;
    slotting = true;
    lastResult = null;
    render();
    try {
      const result = await deps.removeCard(item.itemId, item.copyId, index, expectedCards);
      if (result?.ok) {
        lastResult = { text: `${cardName(card)} is back in your cards.`, good: true };
        deps.showMessage(`Card Removed · ${cardName(card)}`, "#ffd75e");
      } else {
        lastResult = { text: result?.error ?? "Not connected", good: false };
        deps.showMessage(result?.error ?? "Not Connected", "#ff9b91");
      }
    } finally {
      slotting = false;
      if (dialog.open) render();
    }
  }

  async function slot(item: SmithItem, cardId: string, expectedCards: number) {
    const card = cardDefinition(cardId);
    if (slotting || !card || !deps.slotCard) return;
    slotting = true;
    lastResult = null;
    render();
    try {
      const result = await deps.slotCard(item.itemId, item.copyId, cardId, expectedCards);
      if (result?.ok) {
        pickedCard = null;
        lastResult = { text: `${cardName(card)} slotted into ${nameOf(item.itemId)}.`, good: true };
        deps.showMessage(`Card Slotted · ${cardName(card)}`, "#ffd75e");
      } else {
        lastResult = { text: result?.error ?? "Not connected", good: false };
        deps.showMessage(result?.error ?? "Not Connected", "#ff9b91");
      }
    } finally {
      slotting = false;
      if (dialog.open) render();
    }
  }

  function setTab(next: "refine" | "cards") {
    if (slotting || tab === next) return;
    tab = next;
    lastResult = null;
    pickedCard = null;
    render();
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
    // Each visit goes by the server's word on the pickaxe: a reset save takes it back.
    pickaxeTaken = false;
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
  tabButtons.forEach((button, index) => {
    button.addEventListener("click", () => setTab(button.dataset.tab === "cards" ? "cards" : "refine"));
    button.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next = tabButtons[(index + 1) % tabButtons.length];
      setTab(next.dataset.tab === "cards" ? "cards" : "refine");
      next.focus();
    });
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
    itemRefine?: (itemId: string, copyId?: bigint) => number;
    itemUpgradeLevel?: (itemId: string) => number;
    ores?: () => Readonly<Partial<Record<OreId, number>>>;
    refineItem?: (itemId: string, copyId: bigint, expectedLevel: number) => Promise<Result>;
    researchInPlay?: () => { refineLuck?: number };
    equipmentCopies?: () => readonly { id: bigint; itemId: string }[];
    setOnRefineResult?: (callback: ((result: RefineResult) => void) | null) => void;
    cards?: () => Readonly<Record<string, number>>;
    gearSlots?: (itemId: string, copyId?: bigint) => GearSlots;
    slotCard?: (itemId: string, copyId: bigint, cardId: string, expectedCards: number) => Promise<Result>;
    removeCard?: (itemId: string, copyId: bigint, index: number, expectedCards: number) => Promise<Result>;
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
    refineLuck: () => deps.coop()?.researchInPlay?.()?.refineLuck ?? 0,
    hasPickaxe: () => deps.coop()?.hasPickaxe?.() ?? false,
    claimPickaxe: async () => deps.coop()?.claimPickaxe?.() ?? { ok: false, error: "Not Connected" },
    hasStarterStaff: () => inventory.itemIds.includes(STARTER_STAFF),
    claimStarterStaff: async () => deps.coop()?.claimStarterStaff?.() ?? { ok: false, error: "Not Connected" },
    mining: () => deps.coop()?.mining?.() ?? 0,
    cards: () => deps.coop()?.cards?.() ?? {},
    gearSlots: (itemId, copyId) => deps.coop()?.gearSlots?.(itemId, copyId) ?? { slots: 0, cards: [] },
    slotCard: async (itemId, copyId, cardId, expectedCards) => deps.coop()?.slotCard?.(itemId, copyId, cardId, expectedCards) ?? { ok: false, error: "Not Connected" },
    removeCard: async (itemId, copyId, index, expectedCards) => deps.coop()?.removeCard?.(itemId, copyId, index, expectedCards) ?? { ok: false, error: "Not Connected" },
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
