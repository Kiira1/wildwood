import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { byMapThenRarity, createCardsTab, lockedSlotsText, type CardsPort } from "./cards-tab";
import type { ActiveCards, ActiveCardSlots } from "../../shared/active-cards";
import { createInventoryController } from "./inventory-controller";
import { createItemInspectionController } from "./item-inspection-controller";
import { IRON_BOW, STARTER_BOW, STARTER_STONE } from "../game/inventory";
import { watchCardDrops } from "./card-drop-feedback";
import { setCardFoundPopupsEnabled } from "./card-found-setting";
import { CARDS, cardKillChance } from "../../shared/cards";
afterEach(() => vi.unstubAllGlobals());

function page(body = "") {
  const { document, window } = parseHTML(`<html><body>${body}</body></html>`);
  vi.stubGlobal("document", document); vi.stubGlobal("window", window); vi.stubGlobal("navigator", {});
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  return { document, window };
}

const INVENTORY_PANEL = `<div id="inventoryPanel">
  <div class="inventory-tabs"><button id="inventoryEquipmentTab"></button><button id="inventoryCosmeticsTab"></button><button id="inventoryCardsTab"></button></div>
  <div id="inventoryContent">
    <section class="inventory-loadout"><button id="equippedHeadSlot"></button><button id="equippedChestSlot"></button><button id="equippedFeetSlot"></button><button id="equippedRightHandSlot"></button></section>
    <section class="bag-section"><div class="inventory-section-title"><span id="inventoryCount"></span></div><div id="inventoryItems"></div></section>
  </div>
</div>`;

type Port = CardsPort & { calls: unknown[] };
/** A Cards tab port: cards owned, the active ones, slots in play and the odds inputs, recording each call. */
function fakePort(options: { held?: Record<string, number>; active?: Partial<ActiveCards>; slots?: Partial<ActiveCardSlots>; ranks?: Record<string, number>;
  hunter?: number; luck?: number; mapId?: string } = {}): Port {
  const calls: unknown[] = [];
  const state = { held: options.held ?? {}, active: { HAND: [], HEAD: [], CHEST: [], ...options.active } as ActiveCards };
  return {
    calls,
    cards: () => state.held,
    activeCards: () => state.active,
    slots: () => ({ HAND: 1, HEAD: 1, CHEST: 1, ...options.slots }),
    storedRanks: () => options.ranks ?? {},
    cardHunter: () => options.hunter ?? 0,
    cardLuck: () => options.luck ?? 0,
    mapId: () => options.mapId ?? "tutorial_forest",
    activate: async (cardId, expectedActive) => {
      calls.push(["activate", cardId, expectedActive]);
      const card = CARDS.find(candidate => candidate.id === cardId)!;
      state.active = { ...state.active, [card.slot]: [...state.active[card.slot], cardId] };
      return { ok: true };
    },
    deactivate: async (type, index, cardId) => { calls.push(["deactivate", type, index, cardId]); return { ok: false, error: "Your active cards changed. Try again." }; },
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

function inventoryWithCards(port?: CardsPort, inspection?: ReturnType<typeof createItemInspectionController>) {
  const { document, window } = page(INVENTORY_PANEL + INSPECTION_PANEL);
  const inventory = { itemIds: [STARTER_STONE, STARTER_BOW, IRON_BOW], equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: STARTER_STONE, equippedLeftHand: "", cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "", selectedItemId: "", selectedItemLocation: "" as const };
  const opened: Array<Record<string, unknown>> = [];
  const messages: string[] = [];
  const itemInspection = inspection ?? createItemInspectionController({ panel: document.getElementById("panel")!, title: document.getElementById("title")!,
    content: document.getElementById("content")!, back: document.getElementById("back") as HTMLButtonElement });
  const open = itemInspection.open;
  itemInspection.open = (request: any) => { opened.push(request); return open(request); };
  const controller = createInventoryController({ inventory, move: () => false, moveCosmetic: () => false, toggleCosmeticVisibility: () => false,
    upgradeLevel: () => 0, inventorySlotsUnlocked: () => 0, gemBalance: () => 0n, cards: port, itemInspection,
    destroyEquipment: async () => undefined, unlockInventorySlot: async () => undefined, showMessage: (message: string) => { messages.push(message); } });
  controller.render();
  const press = (target: Element, key: string) => {
    const event = new window.Event("keydown");
    Object.defineProperty(event, "key", { value: key });
    target.dispatchEvent(event);
  };
  return { document, controller, opened, messages, press, content: document.getElementById("content")!, panel: document.getElementById("panel")! };
}

const INSPECTION_PANEL = `<section id="panel" hidden><div class="item-inspection-tools"></div><h2 id="title"></h2><div id="content"></div><button id="back"></button></section>`;
const rows = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(".cards-row")];
const zone = (root: ParentNode, mapId: string) => root.querySelector<HTMLElement>(`.cards-zone[data-map-id="${mapId}"]`)!;

it("lists each zone's cards with where they drop and this player's odds, the server's own chance", () => {
  page();
  vi.stubGlobal("localStorage", memoryStorage());
  const port = fakePort({ held: { spitter_card: 3, king_slime_card: 2, dragon_card: 1, not_a_card: 4 }, hunter: .14, luck: 0 });
  const tab = createCardsTab({ port, onInspect: () => undefined });
  tab.show(true);
  expect(tab.element.querySelector(".cards-tab-count")!.textContent).toBe(`3 / ${CARDS.length} Found`);
  const forest = rows(zone(tab.element, "tutorial_forest"));
  expect(forest.map(row => row.dataset.cardId)).toEqual(CARDS.filter(card => card.mapId === "tutorial_forest").sort(byMapThenRarity).map(card => card.id));
  const line = (cardId: string) => forest.find(row => row.dataset.cardId === cardId)!.querySelector(".cards-row-odds")!.textContent;
  // 1 in 1,000 at plain odds, raised 14% by Card Hunter: the chance the server rolls (cardKillChance).
  expect(line("spitter_card")).toBe("Spitter · Tutorial Forest · 1 in 877 kills");
  expect(Math.round(1 / cardKillChance(CARDS.find(card => card.id === "spitter_card")!, .14, 0))).toBe(877);
  expect(line("king_slime_card")).toBe("King Slime · Tutorial Forest · 1 in 1,754 kills");
  expect(line("dragon_card")).toBe("Dragon · Tutorial Forest · 1 in 88 boss kills");
  const spitter = forest.find(row => row.dataset.cardId === "spitter_card")!;
  expect(spitter.querySelector("strong")!.textContent).toBe("Spitter Card");
  expect(spitter.querySelector(".cards-row-count")!.textContent).toBe("×3");
  const needle = forest.find(row => row.dataset.cardId === "needle_card")!;
  expect(needle.classList.contains("is-unfound")).toBe(true);
  expect(needle.querySelector(".cards-row-count")!.textContent).toBe("");
  // The list shows odds, not effects: those are in the card's window.
  expect(tab.element.textContent).not.toContain("Damage +2%");
});

it("opens the current map's zone and closes the rest, remembers each zone on this device, with big header rows", () => {
  page();
  const storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
  const port = fakePort({ held: { needle_card: 1, dune_raider_card: 1 }, active: { HAND: ["needle_card"] }, mapId: "beginner_desert" });
  const tab = createCardsTab({ port, onInspect: () => undefined });
  tab.show(true);
  const header = (mapId: string) => zone(tab.element, mapId).querySelector<HTMLButtonElement>(".cards-zone-header")!;
  const isOpen = (mapId: string) => header(mapId).getAttribute("aria-expanded") === "true";
  expect([isOpen("tutorial_forest"), isOpen("beginner_desert"), isOpen("ion_citadel")]).toEqual([false, true, false]);
  expect(rows(zone(tab.element, "tutorial_forest"))).toHaveLength(0);
  expect(header("tutorial_forest").querySelector(".cards-zone-name")!.textContent).toBe("Tutorial Forest");
  expect(header("tutorial_forest").querySelector(".cards-zone-count")!.textContent)
    .toBe(`1 / ${CARDS.filter(card => card.mapId === "tutorial_forest").length} Owned · 1 Active`);
  header("tutorial_forest").click();
  header("beginner_desert").click();
  expect([isOpen("tutorial_forest"), isOpen("beginner_desert")]).toEqual([true, false]);
  expect(rows(zone(tab.element, "tutorial_forest")).length).toBeGreaterThan(0);
  expect(JSON.parse(storage.values.get("wildstat.cardZonesOpen")!)).toMatchObject({ tutorial_forest: true, beginner_desert: false });
  // A new tab on the same device starts as it was left; the active cards stay above the zones.
  const again = createCardsTab({ port, onInspect: () => undefined });
  again.show(true);
  expect(zone(again.element, "tutorial_forest").querySelector(".cards-zone-header")!.getAttribute("aria-expanded")).toBe("true");
  expect(zone(again.element, "beginner_desert").querySelector(".cards-zone-header")!.getAttribute("aria-expanded")).toBe("false");
  expect(again.element.firstElementChild!.classList.contains("cards-active")).toBe(true);
  expect(again.element.querySelector(".cards-zones .cards-active")).toBeNull();
  // Storage that throws (a private window) still works for the visit.
  vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  const blocked = createCardsTab({ port, onInspect: () => undefined });
  blocked.show(true);
  zone(blocked.element, "ion_citadel").querySelector<HTMLButtonElement>(".cards-zone-header")!.click();
  expect(zone(blocked.element, "ion_citadel").querySelector(".cards-zone-header")!.getAttribute("aria-expanded")).toBe("true");
});

it("pins the active cards on top: four slots a type, filled, empty, waiting and locked, and says which perk opens more", () => {
  page();
  vi.stubGlobal("localStorage", memoryStorage());
  const inspected: string[] = [], empty: string[] = [];
  const port = fakePort({ held: { needle_card: 4, brood_card: 1 }, active: { HAND: ["needle_card", "needle_card", "needle_card"], HEAD: ["brood_card"] },
    slots: { HAND: 2 }, ranks: { weaponCards: 1 } });
  const tab = createCardsTab({ port, onInspect: cardId => inspected.push(cardId), onEmptySlot: type => empty.push(type) });
  tab.show(true);
  const row = (type: string) => tab.element.querySelector<HTMLElement>(`.cards-active-row[data-type="${type}"]`)!;
  const slots = (type: string) => [...row(type).querySelectorAll<HTMLElement>(".cards-slot")].map(slot => slot.className.replace("cards-slot ", "") + ":" + slot.textContent);
  expect(slots("HAND")).toEqual(["is-filled is-regular:Needle", "is-filled is-regular:Needle", "is-filled is-regular is-waiting:Waiting", "is-locked:Locked"]);
  expect(slots("CHEST")).toEqual(["is-empty:Empty", "is-locked:Locked", "is-locked:Locked", "is-locked:Locked"]);
  expect(row("HAND").querySelector(".cards-active-head")!.textContent).toBe("Weapon2 / 2");
  expect(row("HAND").querySelector(".cards-lock-note")!.textContent).toBe("Locked: the Weapon Card Slots perk opens 2 more");
  expect(row("CHEST").querySelector(".cards-lock-note")!.textContent).toBe("Locked: the Armor Card Slots perk opens 3 more");
  row("HEAD").querySelector<HTMLElement>(".cards-slot.is-filled")!.click();
  row("CHEST").querySelector<HTMLElement>(".cards-slot.is-empty")!.click();
  expect([inspected, empty]).toEqual([["brood_card"], ["CHEST"]]);
  // A perk owned but out of play (an Aggro run, or switched off) says so.
  const aggro = createCardsTab({ port: fakePort({ active: { HAND: ["needle_card", "needle_card"] }, ranks: { weaponCards: 3 } }), onInspect: () => undefined });
  aggro.show(true);
  expect(aggro.element.querySelector('.cards-active-row[data-type="HAND"] .cards-lock-note')!.textContent).toBe("Weapon Card Slots is not in play now: 1 slot");
  expect(lockedSlotsText("HAND", 4, 3)).toBe("");
});

it("puts a Cards tab beside Equipment and Cosmetics that swaps the loadout and bag for the cards", () => {
  vi.stubGlobal("localStorage", memoryStorage());
  const view = inventoryWithCards(fakePort({ held: { needle_card: 2 } }));
  const [equipment, cosmetics, cards] = ["inventoryEquipmentTab", "inventoryCosmeticsTab", "inventoryCardsTab"].map(id => view.document.getElementById(id)!);
  const shown = () => [".inventory-loadout", ".bag-section", ".cards-tab"].map(selector => !view.document.querySelector<HTMLElement>(selector)!.hidden);
  expect(shown()).toEqual([true, true, false]);
  cards.click();
  expect(shown()).toEqual([false, false, true]);
  expect([equipment, cosmetics, cards].map(tab => tab.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
  expect(view.document.getElementById("inventoryContent")!.getAttribute("aria-labelledby")).toBe("inventoryCardsTab");
  // Arrow keys walk all three tabs and wrap around.
  view.press(cards, "ArrowRight");
  expect(equipment.getAttribute("aria-selected")).toBe("true");
  expect(shown()).toEqual([true, true, false]);
  view.press(equipment, "ArrowLeft");
  expect(cards.getAttribute("aria-selected")).toBe("true");
  cosmetics.click();
  expect(cosmetics.getAttribute("aria-selected")).toBe("true");
  expect(shown()).toEqual([true, true, false]);
});

it("opens a card's window with its effects, what is owned and active, its odds and Activate, then shows it active", async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  const port = fakePort({ held: { ember_raider_card: 2, needle_card: 1 }, active: { HAND: [] }, mapId: "advanced_lava_wastes", slots: { HAND: 2 } });
  const view = inventoryWithCards(port);
  view.document.getElementById("inventoryCardsTab")!.click();
  view.document.querySelector<HTMLElement>('.cards-row[data-card-id="ember_raider_card"]')!.click();
  expect(view.panel.hidden).toBe(false);
  expect(view.content.querySelector(".card-origin")!.textContent).toBe("Regular · Advanced Lava Lake");
  expect(view.content.querySelector(".item-inspection-context")!.textContent).toBe("Weapon Card · 2 Owned · 0 Active");
  expect([...view.content.querySelectorAll(".item-inspection-stats span")].map(span => [span.textContent, span.getAttribute("data-stat-kind")]))
    .toEqual([["Damage +4.9%", "card"], ["Max Health -3.6%", "cost"]]);
  expect(view.content.querySelector(".item-inspection-card-odds")!.textContent).toBe("Advanced Lava Lake · 1 in 1,000 kills · Sure by 2,000 kills");
  const button = (label: string) => [...view.document.querySelectorAll<HTMLButtonElement>(".item-inspection-actions button")].find(candidate => candidate.textContent === label);
  button("Activate")!.click();
  await vi.waitFor(() => expect(port.calls).toEqual([["activate", "ember_raider_card", 0]]));
  await vi.waitFor(() => expect(view.content.querySelector(".item-inspection-context")!.textContent).toBe("Weapon Card · 2 Owned · 1 Active"));
  expect(view.messages.at(-1)).toBe("Activated · Ember Raider Card");
  expect(view.content.querySelector(".item-inspection-card-note")!.textContent).toBe("Weapon Slot 1");
  // Both slots taken: no more Activate for the Needle card, and the window says why.
  button("Activate")!.click();
  await vi.waitFor(() => expect(port.calls).toHaveLength(2));
  (view.document.querySelector('.cards-zone[data-map-id="tutorial_forest"] .cards-zone-header') as HTMLElement).click();
  view.document.querySelector<HTMLElement>('.cards-row[data-card-id="needle_card"]')!.click();
  expect(button("Activate")).toBeUndefined();
  expect(view.content.querySelector(".item-inspection-card-note")!.textContent).toBe("Every Weapon card slot is full. Deactivate one first.");
  // Deactivate the Ember Raider card: the refusal is shown.
  view.document.querySelector<HTMLElement>('.cards-row[data-card-id="ember_raider_card"]')!.click();
  button("Deactivate")!.click();
  await vi.waitFor(() => expect(port.calls.at(-1)).toEqual(["deactivate", "HAND", 1, "ember_raider_card"]));
  await vi.waitFor(() => expect(view.messages.at(-1)).toBe("Your active cards changed. Try again."));
  // One never found shows its odds and says so instead of a count.
  view.document.querySelector<HTMLElement>('.cards-row[data-card-id="spitter_card"]')!.click();
  expect(view.content.querySelector(".item-inspection-context")!.textContent).toBe("Weapon Card · Not Found Yet");
  expect(button("Activate")).toBeUndefined();
});

it("pins the tabs above the inventory body, which scrolls by itself", () => {
  vi.stubGlobal("localStorage", memoryStorage());
  const view = inventoryWithCards(fakePort());
  const scroll = view.document.querySelector(".inventory-scroll")!;
  expect(scroll.contains(view.document.getElementById("inventoryContent"))).toBe(true);
  expect(scroll.contains(view.document.querySelector(".inventory-tabs"))).toBe(false);
});

it("leaves the Cards tab out where there are no card rows", () => {
  const view = inventoryWithCards();
  expect(view.document.getElementById("inventoryCardsTab")).toBeNull();
  expect(view.document.querySelector(".cards-tab")).toBeNull();
});

it("shows no card slots on gear in the bag", () => {
  vi.stubGlobal("localStorage", memoryStorage());
  const view = inventoryWithCards(fakePort());
  view.document.querySelector<HTMLElement>(`#inventoryItems [data-item-id="${IRON_BOW}"]`)!.click();
  expect(view.opened.at(-1)).toMatchObject({ itemId: IRON_BOW });
  expect(view.content.querySelector(".item-inspection-cards")).toBeNull();
  expect(view.content.textContent).not.toMatch(/slot/i);
});

it("shows a profile's active cards of an item's type in its window: each card's portrait, name and effects", () => {
  const { document } = page(INSPECTION_PANEL);
  const content = document.getElementById("content")!;
  const controller = createItemInspectionController({ panel: document.getElementById("panel")!, title: document.getElementById("title")!,
    content, back: document.getElementById("back") as HTMLButtonElement });
  controller.open({ itemId: IRON_BOW, activeCards: { title: "Active Weapon Cards", cards: ["needle_card", "ember_raider_card"] } });
  expect(content.querySelector(".item-inspection-cards .item-inspection-section-title")?.textContent).toBe("Active Weapon Cards2");
  expect([...content.querySelectorAll(".item-card-slot")].map(slot => [slot.className,
    ...[...slot.querySelectorAll(".item-card-text > *")].map(line => line.textContent)])).toEqual([
    ["item-card-slot is-regular", "Needle Card", "1% chance a hit lands twice"],
    ["item-card-slot is-regular", "Ember Raider Card", "Damage +4.9%", "Max Health -3.6%"],
  ]);
  controller.open({ itemId: IRON_BOW, activeCards: { title: "Active Weapon Cards", cards: [] } });
  expect(content.querySelector(".item-card-text strong")!.textContent).toBe("None Active");
  controller.open({ itemId: IRON_BOW });
  expect(content.querySelector(".item-inspection-cards")).toBeNull();
});

it("hands each card found to the card moment, in the order found, with its portrait", async () => {
  page();
  let listener = null as ((drop: { cardIds: readonly string[] }) => void) | null;
  const shown: Array<{ cardId: string; artSource: string }> = [];
  watchCardDrops({ setOnCardDrop: callback => { listener = callback; } }, found => shown.push(found));
  listener?.({ cardIds: ["needle_card", "not_a_card", "dragon_card"] });
  await vi.waitFor(() => expect(shown).toHaveLength(2));
  expect(shown.map(found => found.cardId)).toEqual(["needle_card", "dragon_card"]);
  expect(shown.every(found => typeof found.artSource === "string")).toBe(true);
});

it("shows the pickaxe in the loadout's Tool slot, never to be equipped, and says what it does", () => {
  const { document } = page(INVENTORY_PANEL);
  const inventory = { itemIds: [STARTER_STONE], equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: STARTER_STONE, equippedLeftHand: "", cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "", selectedItemId: "", selectedItemLocation: "" as const };
  let owned = false;
  const messages: string[] = [];
  const controller = createInventoryController({ inventory, move: () => false, moveCosmetic: () => false, toggleCosmeticVisibility: () => false,
    upgradeLevel: () => 0, inventorySlotsUnlocked: () => 0, gemBalance: () => 0n, hasPickaxe: () => owned,
    itemInspection: { close() {}, open() { return true; } } as any,
    destroyEquipment: async () => undefined, unlockInventorySlot: async () => undefined, showMessage: (message: string) => { messages.push(message); } });
  controller.render();
  const tool = document.querySelector<HTMLButtonElement>(".inventory-loadout .slot-tool")!;
  expect(tool.textContent).toBe("TOOL");
  tool.click();
  expect(messages.at(-1)).toBe("Get a pickaxe from the Smith in Town.");
  owned = true;
  controller.render();
  expect(tool.classList.contains("is-equipped")).toBe(true);
  expect(tool.getAttribute("aria-label")).toBe("Tool: Pickaxe, always ready");
  tool.click();
  expect(messages.at(-1)).toContain("no need to equip");
  document.getElementById("inventoryCosmeticsTab")!.click();
  expect(tool.hidden).toBe(true);
});

it("shows no card moment with Card Found Popups switched off", async () => {
  page();
  let listener = null as ((drop: { cardIds: readonly string[] }) => void) | null;
  const shown: unknown[] = [];
  watchCardDrops({ setOnCardDrop: callback => { listener = callback; } }, found => shown.push(found));
  setCardFoundPopupsEnabled(false);
  listener?.({ cardIds: ["needle_card"] });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(shown).toEqual([]);
  setCardFoundPopupsEnabled(true);
  listener?.({ cardIds: ["needle_card"] });
  await vi.waitFor(() => expect(shown).toHaveLength(1));
});
