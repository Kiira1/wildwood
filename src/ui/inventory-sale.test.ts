import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createInventoryController, type KeptEquipmentCopy } from "./inventory-controller";
import type { ItemInspectionRequest } from "./item-inspection-controller";
import type { ConfirmRequest } from "./confirm-dialog";
import { SAMURAI_HAT, STARTER_STONE } from "../game/inventory";
import { gradeSalePrice } from "../../shared/gear-grades";
import { createInventoryCommerceActions } from "../game/runtime/inventory-commerce";
afterEach(() => vi.unstubAllGlobals());

const ROLL = { arrowStorm: 0, ricochet: 0, piercingShot: 0 };

function bag(options: { worn?: string; copies?: KeptEquipmentCopy[]; locked?: boolean; refine?: number } = {}) {
  const ids = ["inventoryPanel", "inventoryItems", "inventoryCount", "equippedHeadSlot", "equippedChestSlot", "equippedFeetSlot", "equippedRightHandSlot", "inventoryEquipmentTab", "inventoryCosmeticsTab", "inventoryContent"];
  const { document, window } = parseHTML(`<html><body>${ids.map(id => `<div id="${id}"></div>`).join("")}</body></html>`);
  vi.stubGlobal("document", document); vi.stubGlobal("window", window); vi.stubGlobal("navigator", {});
  const inventory = { itemIds: [STARTER_STONE, "rare_bow", SAMURAI_HAT], equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: options.worn ?? "", equippedLeftHand: "",
    cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "", selectedItemId: "", selectedItemLocation: "" as const };
  const opened: ItemInspectionRequest[] = [], calls: string[] = [], messages: string[] = [], asked: ConfirmRequest[] = [];
  const controller = createInventoryController({ inventory, toggleCosmeticVisibility: () => false, move: () => true,
    moveCosmetic: () => false, upgradeLevel: () => 0, refineLevel: () => options.refine ?? 0, inventorySlotsUnlocked: () => 0, gemBalance: () => 0n,
    itemInspection: { close() {}, open(request: ItemInspectionRequest) { opened.push(request); return true; } } as any,
    destroyEquipment: async () => ({ ok: true }),
    sellGradedItem: async (itemId, copyId) => { calls.push(`sell ${itemId} copy ${copyId}`); return { ok: true }; },
    equipmentCopies: () => options.copies ?? [],
    equipmentLocked: () => options.locked ?? false,
    confirmDestroy: async request => { asked.push(request); return true; },
    unlockInventorySlot: async () => undefined, showMessage: message => { messages.push(message); } });
  controller.render();
  const items = document.getElementById("inventoryItems")!;
  const open = (itemId: string, copyId?: bigint) => {
    [...items.querySelectorAll<HTMLElement>(`[data-item-id="${itemId}"]`)]
      .find(button => button.getAttribute("data-copy-id") === (copyId === undefined ? null : String(copyId)))!.click();
    return opened.at(-1)!;
  };
  const sale = (request: ItemInspectionRequest) => request.actions?.find(action => action.label.startsWith("Sell for"));
  const openWorn = () => { document.getElementById("equippedRightHandSlot")!.click(); return opened.at(-1)!; };
  return { controller, open, openWorn, sale, calls, messages, asked };
}

it("offers graded gear in the bag for half its price, confirms, and sells through the service", async () => {
  const view = bag({ refine: 3 });
  const action = view.sale(view.open("rare_bow"))!;
  expect(action.label).toBe(`Sell for ${gradeSalePrice("rare")} Gold`);
  await action.onActivate();
  expect(view.asked[0].message).toMatch(new RegExp(`^Sell .* for ${gradeSalePrice("rare")} Gold\\?$`));
  expect(view.asked[0].details).toContainEqual({ label: "Refines", value: "Lost with the item" });
  expect(view.calls).toEqual(["sell rare_bow copy 0"]);
  expect(view.messages).toEqual([`Sold · +${gradeSalePrice("rare")} Gold`]);
});

it("sells a kept copy by its own id", async () => {
  const view = bag({ worn: "rare_bow", copies: [{ id: 7n, itemId: "rare_bow", roll: ROLL }] });
  await view.sale(view.open("rare_bow", 7n))!.onActivate();
  expect(view.calls).toEqual(["sell rare_bow copy 7"]);
});

it("offers no sale for ungraded, worn or locked gear", () => {
  const hat = bag();
  expect(hat.sale(hat.open(SAMURAI_HAT))).toBeUndefined();
  const worn = bag({ worn: "rare_bow" });
  expect(worn.openWorn().itemId).toBe("rare_bow");
  expect(worn.sale(worn.openWorn())).toBeUndefined();
  const locked = bag({ locked: true });
  expect(locked.sale(locked.open("rare_bow"))).toBeUndefined();
});

it("drops the last copy from the local bag on a sale, but not one of several", async () => {
  const sold = vi.fn(async () => ({ ok: true }));
  const make = (copies: KeptEquipmentCopy[]) => {
    const inventory = { itemIds: ["rare_bow"], itemQuantities: { rare_bow: 1 } } as any;
    const player = { speed: 1, baseMaxHp: 100, maxHp: 100, hp: 100 };
    const actions = createInventoryCommerceActions({ inventory, player, coop: () => ({ sellGradedItem: sold, equipmentCopies: () => copies }),
      healthMultiplierBonus: () => 0, movementSpeed: () => 1 });
    return { inventory, actions };
  };
  const last = make([]);
  await last.actions.sellGradedItem("rare_bow", 0n);
  expect(last.inventory.itemIds).not.toContain("rare_bow");
  const several = make([{ id: 7n, itemId: "rare_bow", roll: ROLL }]);
  await several.actions.sellGradedItem("rare_bow", 0n);
  expect(several.inventory.itemIds).toContain("rare_bow");
  expect(sold).toHaveBeenCalledWith("rare_bow", 0n);
});
