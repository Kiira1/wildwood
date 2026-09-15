import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createInventoryController } from "./inventory-controller";
import { STARTER_BOW, STARTER_STONE, FROST_ARMOR } from "../game/inventory";
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
