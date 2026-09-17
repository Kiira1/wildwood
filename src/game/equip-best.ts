import { BLACK_BOOTS, BLACK_BOOTS_SPEED_BONUS, isCosmeticOnlyItem, itemDefinition, type EquipmentSlot } from "../../shared/items";
import { moveInventoryItem, type InventoryState } from "./inventory";

/** Equipment bonuses are additive, so each slot can be scored independently. */
export function bestEquipmentMoves(inventory: InventoryState, power: (candidate: InventoryState) => number) {
  const planned = { ...inventory };
  const moves: { itemId: string; destination: EquipmentSlot }[] = [];
  for (const [slot, field, destination] of [
    ["HAND", "equippedRightHand", "RIGHT_HAND"],
    ["HEAD", "equippedHead", "HEAD"],
    ["CHEST", "equippedChest", "CHEST"],
    ["FEET", "equippedFeet", "FEET"],
  ] as const) {
    const current = slot === "HAND" ? planned.equippedRightHand || planned.equippedLeftHand : planned[field];
    let best = current;
    const score = (candidate: InventoryState) => slot === "FEET"
      ? candidate.equippedFeet === BLACK_BOOTS ? BLACK_BOOTS_SPEED_BONUS : 0
      : power(candidate);
    let bestScore = score(planned);
    for (const itemId of inventory.itemIds) {
      if (isCosmeticOnlyItem(itemId) || itemDefinition(itemId)?.slot !== slot) continue;
      const candidate = { ...planned };
      moveInventoryItem(candidate, itemId, destination);
      const candidateScore = score(candidate);
      // Keep an equipped item on ties, but fill an empty slot even at zero power.
      if (candidateScore > bestScore || (!best && candidateScore === bestScore)) {
        best = itemId;
        bestScore = candidateScore;
      }
    }
    if (best && best !== current && moveInventoryItem(planned, best, destination)) moves.push({ itemId: best, destination });
  }
  return moves;
}
