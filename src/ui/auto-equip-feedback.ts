import { itemDisplayName } from "../../shared/items";
import type { InventoryState } from "../game/inventory";
import { applyPlayerMaxHealthMultiplierBonus } from "../game/runtime/player-health";
import type { PlayerState } from "../game/runtime/types";
import type { ServerEquip } from "../coop/services/progression-service";
import { EQUIPPED_FIELDS, applyServerLoadout, type ServerLoadoutChange } from "../coop/services/server-loadout";
import { itemInspectionButtonLabel } from "./item-inspection-controller";

/** What the feedback needs from the coop session; an older API simply never calls it. */
export type ServerEquipPort = {
  setOnServerEquip?: (callback: ((equip: ServerEquip) => void) | null) => void;
};

/**
 * The toast for gear the server put on by itself, or null when there is
 * nothing to boast about: a slot emptied is not an upgrade. The weapon is named first.
 */
export function autoEquipMessage(changes: readonly ServerLoadoutChange[]) {
  const upgrades = changes.filter(({ itemId }) => itemId);
  const shown = upgrades.find(({ field }) => field === "equippedRightHand" || field === "equippedLeftHand") ?? upgrades[0];
  return shown ? `Equipped ${itemInspectionButtonLabel(itemDisplayName(shown.itemId))} (upgrade)` : null;
}

/** The toast for a save's equip the server did not put on. */
export function refusedEquipMessage(changes: readonly ServerLoadoutChange[]) {
  const asked = changes.find(({ previous }) => previous)?.previous;
  return asked ? `Could Not Equip ${itemInspectionButtonLabel(itemDisplayName(asked))}` : null;
}

/**
 * Auto equip happens on the server (better gear new in the bag). The coop session reports each slot it changed; this puts the
 * same gear in the local bag, whose loadout every save sends, refreshes what
 * the gear changes locally and says what went on, or what the server did not take.
 */
export function createAutoEquipFeedback(options: {
  coop: ServerEquipPort | null | undefined;
  inventory: InventoryState;
  player: PlayerState;
  healthMultiplierBonus: () => number;
  renderInventory: () => void;
  showMessage: (message: string, color: string) => void;
}) {
  options.coop?.setOnServerEquip?.(({ changes, live, refused }) => {
    const next = applyServerLoadout(options.inventory, changes);
    const changed = EQUIPPED_FIELDS.filter(field => options.inventory[field] !== next[field]);
    if (!changed.length) return;
    for (const field of changed) options.inventory[field] = next[field];
    applyPlayerMaxHealthMultiplierBonus(options.player, options.healthMultiplierBonus());
    options.renderInventory();
    if (refused) {
      const message = refusedEquipMessage(changes);
      if (message) options.showMessage(message, "#ff9b91");
      return;
    }
    const message = live ? autoEquipMessage(changes) : null;
    if (message) options.showMessage(message, "#72ef58");
  });
}
