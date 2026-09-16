import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createInventoryController } from "./inventory-controller";
import { SUPERIOR_GOLDEN_HELMET, STARTER_BOW, STARTER_STONE, FROST_ARMOR } from "../game/inventory";
afterEach(() => vi.unstubAllGlobals());
it("keeps slots mounted until inventory, upgrades, or selection changes", () => {
  const ids = ["inventoryPanel", "inventoryItems", "inventoryCount", "equippedHeadSlot", "equippedChestSlot", "equippedFeetSlot", "equippedRightHandSlot", "inventoryEquipmentTab", "inventoryCosmeticsTab", "inventoryContent"];
  const { document, window } = parseHTML(`<html><body>${ids.map(id => `<div id="${id}"></div>`).join("")}</body></html>`);
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
  const inventory = { itemIds: [STARTER_STONE, STARTER_BOW], equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: STARTER_STONE, equippedLeftHand: "", cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "", selectedItemId: "", selectedItemLocation: "" as const };
  let level = 0;
  const controller = createInventoryController({ inventory, move: () => false, moveCosmetic: () => false, toggleCosmeticVisibility: () => false,
    upgradeLevel: () => level, itemInspection: { close() {}, open() {} } as any, inventorySlotsUnlocked: () => 0, gemBalance: () => 0n,
    destroyEquipment: async () => undefined, unlockInventorySlot: async () => undefined, showMessage() {} });
  const items = document.getElementById("inventoryItems")!;
  controller.render();
  expect(items.querySelector(".inventory-item-bonuses")!.textContent).toBe("+5%");
  level = 10; controller.render();
  expect(items.querySelector(".inventory-item-bonuses")!.textContent).toBe("+9%");
  level = 0; controller.render();
  let first = items.firstElementChild;
  controller.prepareOpen(); controller.render();
  expect(items.firstElementChild).toBe(first);
  inventory.itemIds.push(FROST_ARMOR); controller.render();
  expect(items.firstElementChild).not.toBe(first);
  first = items.firstElementChild; level = 1; controller.render();
  expect(items.firstElementChild).not.toBe(first);
  first = items.firstElementChild; inventory.selectedItemId = STARTER_BOW; controller.render();
  expect(items.firstElementChild).not.toBe(first);
});


it("switches to a cosmetic-only collection without equipment capacity purchases", () => {
  const ids = ["inventoryPanel", "inventoryItems", "inventoryCount", "equippedHeadSlot", "equippedChestSlot", "equippedFeetSlot", "equippedRightHandSlot", "inventoryEquipmentTab", "inventoryCosmeticsTab", "inventoryContent"];
  const { document, window } = parseHTML(`<html><body>${ids.map(id => `<div id="${id}"></div>`).join("")}</body></html>`);
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
  const inventory = { itemIds: [STARTER_BOW, SUPERIOR_GOLDEN_HELMET], equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: "", equippedLeftHand: "", cosmeticHead: SUPERIOR_GOLDEN_HELMET, cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "", selectedItemId: "", selectedItemLocation: "" as const };
  const controller = createInventoryController({ inventory, move: () => false, moveCosmetic: () => false, toggleCosmeticVisibility: () => false,
    upgradeLevel: () => 0, itemInspection: { close() {}, open() {} } as any, inventorySlotsUnlocked: () => 0, gemBalance: () => 0n,
    destroyEquipment: async () => undefined, unlockInventorySlot: async () => undefined, showMessage() {} });
  const items = document.getElementById("inventoryItems")!;
  controller.render();
  expect(items.querySelectorAll("[data-item-id]").length).toBe(1);
  expect(items.querySelector("[data-item-id]")!.getAttribute("data-item-id")).toBe(STARTER_BOW);
  document.getElementById("inventoryCosmeticsTab")!.click();
  expect(items.querySelectorAll("[data-item-id]").length).toBe(1);
  expect(items.querySelector("[data-item-id]")!.getAttribute("data-item-id")).toBe(SUPERIOR_GOLDEN_HELMET);
  expect(items.children.length).toBe(50);
  expect(items.querySelector(".is-locked")).toBeNull();
  expect(items.querySelector(".inventory-item-bonuses")).toBeNull();
  expect(items.classList.contains("has-stat-bonuses")).toBe(false);
  expect(document.getElementById("inventoryCount")!.textContent).toBe("1 / 50 Cosmetics");
});
