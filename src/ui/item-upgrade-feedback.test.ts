import { expect, it, vi } from "vitest";
import { createItemUpgradeFeedback } from "./item-upgrade-feedback";

it("names the slot that finished, not an item", () => {
  const showMessage = vi.fn();
  const inventory = { itemIds: [] } as never;
  const player = { hp: 10, maxHp: 10, baseMaxHp: 10 } as never;
  const show = createItemUpgradeFeedback({ inventory, player, healthMultiplierBonus: () => 0, renderInventory() {}, saveProgress() {}, showMessage });
  show({ itemId: "HAND", level: 37 });
  expect(showMessage).toHaveBeenCalledWith("Slot Upgrade Complete · Weapon +37", "#72ef58");
});
