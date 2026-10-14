import { bagSlotCapacity } from "../../shared/gems";

/** A player's bag size: the base, the slots bought with Gems, and the Bag Slots research ranks. */
export function bagCapacityFor(ctx: { db: any }, identity: unknown) {
  return bagSlotCapacity(ctx.db.playerInventoryCapacity.identity.find(identity)?.slotsUnlocked ?? 0,
    ctx.db.playerResearch.identity.find(identity)?.inventorySlots ?? 0);
}
