import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createCardsTab } from "./cards-tab";
import { createInventoryController } from "./inventory-controller";
import { createItemInspectionController } from "./item-inspection-controller";
import { formatCompactNumber } from "./number-format";
import { STARTER_BOW, STARTER_STONE } from "../game/inventory";
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

function inventoryWithCards(cards?: () => Record<string, number>) {
  const { document, window } = page(INVENTORY_PANEL);
  const inventory = { itemIds: [STARTER_STONE, STARTER_BOW], equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: STARTER_STONE, equippedLeftHand: "", cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "", selectedItemId: "", selectedItemLocation: "" as const };
  const cardOpened: unknown[] = [];
  const controller = createInventoryController({ inventory, move: () => false, moveCosmetic: () => false, toggleCosmeticVisibility: () => false,
    upgradeLevel: () => 0, inventorySlotsUnlocked: () => 0, gemBalance: () => 0n, cards,
    itemInspection: { close() {}, open() { return true; }, openCard(request: unknown) { cardOpened.push(request); return true; } } as any,
    destroyEquipment: async () => undefined, unlockInventorySlot: async () => undefined, showMessage() {} });
  controller.render();
  const press = (target: Element, key: string) => {
    const event = new window.Event("keydown");
    Object.defineProperty(event, "key", { value: key });
    target.dispatchEvent(event);
  };
  return { document, controller, cardOpened, press };
}

it("shows the cards held in map order, regular before elite before boss, each with its count", () => {
  page();
  const inspected: string[] = [];
  let held: Record<string, number> = { dragon_card: 1, ember_raider_card: 12_345, spitter_card: 3, king_slime_card: 2, not_a_card: 4, needle_card: 0 };
  const tab = createCardsTab({ cards: () => held, onInspect: cardId => inspected.push(cardId) });
  tab.show(true);
  const tiles = () => [...tab.element.querySelectorAll<HTMLElement>(".is-card")];
  expect(tiles().map(tile => tile.getAttribute("data-card-id"))).toEqual(["spitter_card", "king_slime_card", "dragon_card", "ember_raider_card"]);
  expect(tiles().map(tile => tile.querySelector(".item-tier-label")!.textContent)).toEqual(["Spitter", "King Slime", "Dragon", "Ember Raider"]);
  expect(tiles().map(tile => tile.querySelector(".inventory-stack-count")!.textContent)).toEqual(["3", "2", "1", formatCompactNumber(12_345)]);
  expect(tiles()[2].classList.contains("is-boss")).toBe(true);
  expect(tab.element.querySelector<HTMLElement>(".cards-tab-empty")!.hidden).toBe(true);
  tiles()[1].click();
  expect(inspected).toEqual(["king_slime_card"]);
  held = {};
  tab.render();
  expect(tiles()).toEqual([]);
  expect(tab.element.querySelector<HTMLElement>(".cards-tab-empty")!.hidden).toBe(false);
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
  view.document.querySelector<HTMLElement>(".cards-tab .is-card")!.click();
  expect(view.cardOpened).toEqual([{ cardId: "needle_card", count: 2 }]);
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
});
