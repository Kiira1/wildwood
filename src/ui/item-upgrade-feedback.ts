import { isUpgradeSlot, UPGRADE_SLOT_LABELS } from "../../shared/slot-upgrades";
import { setInventoryItemQuantity, type InventoryState } from "../game/inventory";
import { applyPlayerMaxHealthMultiplierBonus } from "../game/runtime/player-health";
import type { PlayerState } from "../game/runtime/types";

/** Apply the immediate local presentation of a server-confirmed slot tier. */
export function createItemUpgradeFeedback(options: {
  inventory: InventoryState;
  player: PlayerState;
  healthMultiplierBonus: () => number;
  renderInventory: () => void;
  saveProgress: (immediate: boolean) => void;
  showMessage: (message: string, color: string) => void;
}) {
  return ({ itemId, level }: { itemId: string; level: number }) => {
    setInventoryItemQuantity(options.inventory, itemId, 1);
    applyPlayerMaxHealthMultiplierBonus(options.player, options.healthMultiplierBonus());
    options.renderInventory();
    options.saveProgress(true);
    // The tier is the slot's (itemId is "HAND", "HEAD" or "CHEST"), so the message names the slot.
    const slot = isUpgradeSlot(itemId) ? `${UPGRADE_SLOT_LABELS[itemId]} SLOT` : "SLOT";
    options.showMessage(`${slot} +${level} COMPLETE`, "#72ef58");
  };
}
