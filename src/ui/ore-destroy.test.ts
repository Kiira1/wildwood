import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createInventoryController } from "./inventory-controller";
import { createItemInspectionController } from "./item-inspection-controller";
import type { ConfirmRequest } from "./confirm-dialog";
import type { OreId } from "../../shared/refine";

afterEach(() => vi.unstubAllGlobals());
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function bag() {
  const ids = ["inventoryPanel", "inventoryItems", "inventoryCount", "equippedHeadSlot", "equippedChestSlot", "equippedFeetSlot", "equippedRightHandSlot", "inventoryEquipmentTab", "inventoryCosmeticsTab", "inventoryContent"];
  const { document, window } = parseHTML(`<html><body>${ids.map(id => `<div id="${id}"></div>`).join("")}
    <section id="inspection" hidden><div class="item-inspection-tools"></div><h2 id="title"></h2>
    <div id="content"></div><button id="back"></button></section></body></html>`);
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLElement", window.HTMLElement); vi.stubGlobal("navigator", {});
  const inspection = createItemInspectionController({ panel: document.getElementById("inspection")!,
    title: document.getElementById("title")!, content: document.getElementById("content")!,
    back: document.getElementById("back") as HTMLButtonElement });
  const ores: Partial<Record<OreId, number>> = { copper_ore: 12 };
  const destroyOre = vi.fn(async (oreId: OreId, _expectedCount: number): Promise<{ ok: boolean; error?: string }> => {
    delete ores[oreId];
    return { ok: true };
  });
  const confirmDestroy = vi.fn(async (_request: ConfirmRequest) => true);
  const showMessage = vi.fn();
  const inventory = { itemIds: ["starter_stone"], equippedHead: "", equippedChest: "", equippedFeet: "",
    equippedRightHand: "starter_stone", equippedLeftHand: "", cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "",
    cosmeticRightHand: "", cosmeticLeftHand: "", selectedItemId: "", selectedItemLocation: "" as const };
  const controller = createInventoryController({ inventory, itemInspection: inspection, ores: () => ores, destroyOre,
    move: () => false, moveCosmetic: () => false, toggleCosmeticVisibility: () => false, upgradeLevel: () => 0,
    inventorySlotsUnlocked: () => 0, gemBalance: () => 0n, destroyEquipment: async () => ({ ok: true }),
    unlockInventorySlot: async () => undefined, confirmDestroy, showMessage });
  controller.render();
  document.querySelector<HTMLElement>('[data-ore-id="copper_ore"]')!.click();
  const destroy = document.querySelector<HTMLButtonElement>('.item-inspection-tools [aria-label="Destroy ore"]')!;
  return { document, ores, inspection, destroy, destroyOre, confirmDestroy, showMessage };
}

it("names the entire ore stack before destruction and leaves it intact when cancelled", async () => {
  const view = bag();
  view.confirmDestroy.mockResolvedValueOnce(false);
  view.destroy.click();
  await settle();
  expect(view.confirmDestroy).toHaveBeenCalledWith(expect.objectContaining({
    message: "Destroy all 12 Copper Ore permanently?", confirmLabel: "Destroy", danger: true,
  }));
  expect(view.destroyOre).not.toHaveBeenCalled();
  expect(view.ores.copper_ore).toBe(12);
  expect(view.inspection.isOpen()).toBe(true);
  expect(view.destroy.disabled).toBe(false);
});

it("destroys the confirmed stack and removes its bag slot after the server succeeds", async () => {
  const view = bag();
  view.destroy.click();
  await settle();
  expect(view.destroyOre).toHaveBeenCalledExactlyOnceWith("copper_ore", 12);
  expect(view.inspection.isOpen()).toBe(false);
  expect(view.document.querySelector('[data-ore-id="copper_ore"]')).toBeNull();
  expect(view.showMessage).toHaveBeenCalledWith("ORE DESTROYED", "#ff9b91");
});

it("keeps the inspected count while ore changes and reports the server's refusal", async () => {
  const view = bag();
  const error = "Your ore stack changed. Reopen it and try again.";
  view.ores.copper_ore = 13;
  view.destroyOre.mockResolvedValueOnce({ ok: false, error });
  view.destroy.click();
  await settle();
  expect(view.destroyOre).toHaveBeenCalledExactlyOnceWith("copper_ore", 12);
  expect(view.ores.copper_ore).toBe(13);
  expect(view.document.querySelector('[data-ore-id="copper_ore"]')).not.toBeNull();
  expect(view.showMessage).toHaveBeenCalledExactlyOnceWith(error, "#ff9b91");
});

it("ignores repeated taps while confirmation is open and clears the ore action on another inspection", async () => {
  const view = bag();
  let confirm!: (accepted: boolean) => void;
  view.confirmDestroy.mockReturnValueOnce(new Promise(resolve => { confirm = resolve; }));
  view.destroy.click();
  view.destroy.click();
  expect(view.confirmDestroy).toHaveBeenCalledTimes(1);
  expect(view.destroy.disabled).toBe(true);
  confirm(false);
  await settle();
  expect(view.destroyOre).not.toHaveBeenCalled();
  view.inspection.open({ itemId: "starter_stone" });
  expect(view.document.querySelector(".item-inspection-destroy")).toBeNull();
});
