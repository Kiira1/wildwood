import { upgradeSlotForItem } from "./slot-upgrades";

/** Slot tiers keyed by slot (HAND, HEAD, CHEST): a tier belongs to the slot, and whatever is in it inherits the tier. */
export type SlotTierMap = Readonly<Record<string, number>> | null | undefined;

/** The tier an item's slot has reached; an item id key reads nothing, since tiers are kept by slot. */
export function slotTierFor(slotTiers: SlotTierMap, itemId: string) {
  return slotTiers?.[upgradeSlotForItem(itemId) ?? ""] ?? 0;
}

/** A worn item's level as stats read it (items.ts ItemLevel): its slot's tier and its own refine. */
export function itemLevelFor(slotTiers: SlotTierMap, refines: Readonly<Record<string, number>> | null | undefined, itemId: string) {
  return { tier: slotTierFor(slotTiers, itemId), refine: refines?.[itemId] ?? 0 };
}
