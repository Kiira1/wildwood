import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { byMapThenRarity, createCardsTab } from "./cards-tab";
import { createInventoryController } from "./inventory-controller";
import { createItemInspectionController } from "./item-inspection-controller";
import { formatCompactNumber } from "./number-format";
import { IRON_BOW, STARTER_BOW, STARTER_STONE } from "../game/inventory";
import { watchCardDrops } from "./card-drop-feedback";
import { setCardFoundPopupsEnabled } from "./card-found-setting";
import { CARDS } from "../../shared/cards";
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

function inventoryWithCards(cards?: () => Record<string, number>, gearSlots?: (itemId: string, copyId?: bigint) => { slots: number; cards: string[] }) {
  const { document, window } = page(INVENTORY_PANEL);
  const inventory = { itemIds: [STARTER_STONE, STARTER_BOW, IRON_BOW], equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: STARTER_STONE, equippedLeftHand: "", cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "", selectedItemId: "", selectedItemLocation: "" as const };
  const cardOpened: unknown[] = [];
  const opened: Array<Record<string, unknown>> = [];
  const controller = createInventoryController({ inventory, move: () => false, moveCosmetic: () => false, toggleCosmeticVisibility: () => false,
    upgradeLevel: () => 0, inventorySlotsUnlocked: () => 0, gemBalance: () => 0n, cards, gearSlots,
    itemInspection: { close() {}, open(request: Record<string, unknown>) { opened.push(request); return true; }, openCard(request: unknown) { cardOpened.push(request); return true; } } as any,
    destroyEquipment: async () => undefined, unlockInventorySlot: async () => undefined, showMessage() {} });
  controller.render();
  const press = (target: Element, key: string) => {
    const event = new window.Event("keydown");
    Object.defineProperty(event, "key", { value: key });
    target.dispatchEvent(event);
  };
  return { document, controller, cardOpened, opened, press };
}

it("shows every card in map order, regular before elite before boss: found ones with their count, the rest as shadows", () => {
  page();
  const inspected: Array<[string, boolean]> = [];
  let held: Record<string, number> = { dragon_card: 1, ember_raider_card: 12_345, spitter_card: 3, king_slime_card: 2, not_a_card: 4, needle_card: 0 };
  let slotted: ReadonlySet<string> = new Set(["brood_card"]);
  const tab = createCardsTab({ cards: () => held, slotted: () => slotted, onInspect: (cardId, found) => inspected.push([cardId, found]) });
  tab.show(true);
  const tiles = () => [...tab.element.querySelectorAll<HTMLElement>(".is-card")];
  const found = () => tiles().filter(tile => !tile.classList.contains("is-unfound"));
  expect(tiles()).toHaveLength(CARDS.length);
  // A card slotted into gear and none held is still found.
  expect(found().map(tile => tile.getAttribute("data-card-id"))).toEqual(["spitter_card", "brood_card", "king_slime_card", "dragon_card", "ember_raider_card"]);
  expect(found().map(tile => tile.querySelector(".item-tier-label")!.textContent)).toEqual(["Spitter", "Brood", "King Slime", "Dragon", "Ember Raider"]);
  expect(found().map(tile => tile.querySelector(".inventory-stack-count")!.textContent)).toEqual(["3", "0", "2", "1", formatCompactNumber(12_345)]);
  expect(found()[3].classList.contains("is-boss")).toBe(true);
  expect(tab.element.querySelector(".cards-tab-count")!.textContent).toBe(`5 / ${CARDS.length} Found`);
  const shadow = tiles().find(tile => tile.getAttribute("data-card-id") === "needle_card")!;
  expect(shadow.classList.contains("is-unfound")).toBe(true);
  expect(shadow.querySelector(".inventory-stack-count")).toBeNull();
  expect(shadow.querySelector(".item-tier-label")!.textContent).toBe("Needle");
  expect(shadow.getAttribute("aria-label")).toBe("Needle Card, not found yet");
  shadow.click();
  found()[2].click();
  expect(inspected).toEqual([["needle_card", false], ["king_slime_card", true]]);
  held = {};
  slotted = new Set();
  tab.render();
  expect(found()).toEqual([]);
  expect(tab.element.querySelector(".cards-tab-count")!.textContent).toBe(`0 / ${CARDS.length} Found`);
});

it("heads each zone's cards with its name and how many of them are found", () => {
  page();
  const tab = createCardsTab({ cards: () => ({ spitter_card: 3, needle_card: 1, dragon_card: 1 }), onInspect: () => undefined });
  tab.show(true);
  const dividers = [...tab.element.querySelectorAll<HTMLElement>(".cards-zone-divider")];
  expect(dividers).toHaveLength(new Set(CARDS.map(card => card.mapId)).size);
  expect(dividers[0].querySelector(".cards-zone-name")!.textContent).toBe("Tutorial Forest");
  expect(dividers[0].querySelector(".cards-zone-count")!.textContent).toBe(`3 / ${CARDS.filter(card => card.mapId === "tutorial_forest").length}`);
  expect(dividers[0].getAttribute("role")).toBe("heading");
  // Each divider sits right before its zone's first card.
  expect(dividers[1].nextElementSibling!.getAttribute("data-card-id")).toBe(CARDS.filter(card => card.mapId === "beginner_desert").sort(byMapThenRarity)[0].id);
});

it("puts a Cards tab beside Equipment and Cosmetics that swaps the loadout and bag for the cards", () => {
  const view = inventoryWithCards(() => ({ needle_card: 2 }));
  const [equipment, cosmetics, cards] = ["inventoryEquipmentTab", "inventoryCosmeticsTab", "inventoryCardsTab"].map(id => view.document.getElementById(id)!);
  const shown = () => [".inventory-loadout", ".bag-section", ".cards-tab"].map(selector => !view.document.querySelector<HTMLElement>(selector)!.hidden);
  expect(shown()).toEqual([true, true, false]);
  cards.click();
  expect(shown()).toEqual([false, false, true]);
  expect([equipment, cosmetics, cards].map(tab => tab.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
  expect(view.document.getElementById("inventoryContent")!.getAttribute("aria-labelledby")).toBe("inventoryCardsTab");
  view.document.querySelector<HTMLElement>('.cards-tab .is-card[data-card-id="needle_card"]')!.click();
  expect(view.cardOpened).toEqual([{ cardId: "needle_card", count: 2, found: true }]);
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

it("pins the tabs above the inventory body, which scrolls by itself", () => {
  const view = inventoryWithCards(() => ({}));
  const scroll = view.document.querySelector(".inventory-scroll")!;
  expect(scroll.contains(view.document.getElementById("inventoryContent"))).toBe(true);
  expect(scroll.contains(view.document.querySelector(".inventory-tabs"))).toBe(false);
});

it("leaves the Cards tab out where there are no card rows", () => {
  const view = inventoryWithCards();
  expect(view.document.getElementById("inventoryCardsTab")).toBeNull();
  expect(view.document.querySelector(".cards-tab")).toBeNull();
});

it("opens a card's window: where it drops, what it goes in, each effect, and its costs marked", () => {
  const { document } = page(`<section id="panel" hidden><div class="item-inspection-tools"></div><h2 id="title"></h2><div id="content"></div><button id="back"></button></section>`);
  const panel = document.getElementById("panel")!, title = document.getElementById("title")!, content = document.getElementById("content")!;
  const controller = createItemInspectionController({ panel, title, content, back: document.getElementById("back") as HTMLButtonElement });
  expect(controller.openCard({ cardId: "not_a_card", count: 1 })).toBe(false);
  expect(controller.openCard({ cardId: "ember_raider_card", count: 2 })).toBe(true);
  expect(panel.hidden).toBe(false);
  expect(title.textContent).toBe("Ember Raider Card");
  expect(content.querySelector(".card-origin")!.textContent).toBe("Regular · Advanced Lava Lake");
  expect(content.querySelector(".item-inspection-context")!.textContent).toBe("Goes In: Weapon · 2 held");
  expect([...content.querySelectorAll(".item-inspection-stats span")].map(span => [span.textContent, span.getAttribute("data-stat-kind")]))
    .toEqual([["Damage +4.9%", "card"], ["Max Health -3.6%", "cost"]]);
  // One never found says so instead of a count.
  controller.openCard({ cardId: "needle_card", count: 0, found: false });
  expect(content.querySelector(".item-inspection-context")!.textContent).toBe("Goes In: Weapon · Not Found Yet");
});

it("shows a gear item's card slots in its window, and none for gear that holds no cards", () => {
  const view = inventoryWithCards(() => ({}), (itemId, copyId) => ({ slots: 2, cards: itemId === IRON_BOW && copyId === 0n ? ["needle_card"] : [] }));
  view.document.querySelector<HTMLElement>(`#inventoryItems [data-item-id="${IRON_BOW}"]`)!.click();
  expect(view.opened.at(-1)).toMatchObject({ itemId: IRON_BOW, cardSlots: { slots: 2, cards: ["needle_card"] } });
  view.document.querySelector<HTMLElement>(`#inventoryItems [data-item-id="${STARTER_STONE}"]`)?.click();
  expect(view.opened.filter(request => request.itemId === STARTER_STONE).every(request => request.cardSlots === undefined)).toBe(true);
});

it("shows a gear copy's card slots in a Cards section: each card's portrait, name and effects, then the open ones", () => {
  const { document } = page(`<section id="panel" hidden><div class="item-inspection-tools"></div><h2 id="title"></h2><div id="content"></div><button id="back"></button></section>`);
  const content = document.getElementById("content")!;
  const controller = createItemInspectionController({ panel: document.getElementById("panel")!, title: document.getElementById("title")!,
    content, back: document.getElementById("back") as HTMLButtonElement });
  controller.open({ itemId: IRON_BOW, ownItem: true, cardSlots: { slots: 3, cards: ["needle_card", "ember_raider_card"] } });
  expect(content.querySelector(".item-inspection-cards .item-inspection-section-title")?.textContent).toBe("Cards2 / 3");
  expect([...content.querySelectorAll(".item-card-slot")].map(slot => [slot.className,
    ...[...slot.querySelectorAll(".item-card-text > *")].map(line => line.textContent)])).toEqual([
    ["item-card-slot is-regular", "Needle Card", "1% chance a hit lands twice"],
    ["item-card-slot is-regular", "Ember Raider Card", "Damage +4.9%", "Max Health -3.6%"],
    ["item-card-slot is-empty", "Empty Slot", "Slot a card at the Smith"],
  ]);
  expect(content.querySelectorAll(".item-card-slot:not(.is-empty) .item-card-art img")).toHaveLength(2);
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
