import { isCosmeticOnlyItem, itemDefinition, type EquipmentSlot } from "../../shared/items";
import { EQUIP_BEST_SLOTS, beatsEquipped, equipSlotScore, equippedInSlot, weaponKind } from "../../shared/equip-best";
import { moveInventoryItem, type InventoryState } from "./inventory";

/**
 * Equipment bonuses are additive, so each slot can be scored independently.
 * What "better" means (the per-slot score and the tie rule) lives in
 * shared/equip-best.ts, which the server's auto equip uses too, and so is
 * the rule that a weapon only replaces one of its own kind: an archer keeps a
 * bow, a swordsman a sword.
 */
export function bestEquipmentMoves(inventory: InventoryState, power: (candidate: InventoryState) => number, canEquip: (itemId: string) => boolean = () => true) {
  const planned = { ...inventory };
  const moves: { itemId: string; destination: EquipmentSlot }[] = [];
  const kind = weaponKind(equippedInSlot(inventory, "HAND"));
  for (const [slot, , destination] of EQUIP_BEST_SLOTS) {
    const current = equippedInSlot(planned, slot);
    let best = current;
    let bestScore = equipSlotScore(slot, planned, power);
    for (const itemId of inventory.itemIds) {
      if (!canEquip(itemId) || isCosmeticOnlyItem(itemId) || itemDefinition(itemId)?.slot !== slot) continue;
      if (slot === "HAND" && weaponKind(itemId) !== kind) continue;
      const candidate = { ...planned };
      moveInventoryItem(candidate, itemId, destination);
      const candidateScore = equipSlotScore(slot, candidate, power);
      if (beatsEquipped(candidateScore, bestScore, best)) {
        best = itemId;
        bestScore = candidateScore;
      }
    }
    if (best && best !== current && moveInventoryItem(planned, best, destination)) moves.push({ itemId: best, destination });
  }
  return moves;
}

/** Equip Best is an explicit player action, so it can replace locked equipment. */
export function equipBestInventory(inventory: InventoryState, power: (candidate: InventoryState) => number,
  canEquip: (itemId: string) => boolean = () => true) {
  const moves = bestEquipmentMoves(inventory, power, canEquip);
  for (const { itemId, destination } of moves) moveInventoryItem(inventory, itemId, destination);
  return moves.length > 0;
}
