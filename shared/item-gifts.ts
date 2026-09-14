import { SUPERIOR_GOLDEN_HELMET, type ItemId } from "./items";

export const ALPHA_TESTER_GIFT_CAMPAIGN = "alpha-testers-2026-09-13";
export const ALPHA_TESTER_GIFT_ITEM = SUPERIOR_GOLDEN_HELMET;
// September 13 in America/Los_Angeles, matching the developer's local date.
export const ALPHA_TESTER_REGISTRATION_START = 1_789_282_800_000_000n;
export const ALPHA_TESTER_REGISTRATION_END = ALPHA_TESTER_REGISTRATION_START + 86_400_000_000n;
export type PendingItemGift = { key: string; itemId: string };

/** Claimed cosmetics cannot be consumed, sold, or discarded by ordinary inventory edits. */
export function claimedGiftItemIds(inventoryJson: string): ItemId[] {
  try {
    const items = JSON.parse(inventoryJson);
    return Array.isArray(items) && items.includes(ALPHA_TESTER_GIFT_ITEM) ? [ALPHA_TESTER_GIFT_ITEM] : [];
  } catch { return []; }
}

export function preserveClaimedGiftItems(inventoryJson: string, serverInventoryJson: string): string {
  const gifts = claimedGiftItemIds(serverInventoryJson);
  if (!gifts.length) return inventoryJson;
  try {
    const items = JSON.parse(inventoryJson);
    if (!Array.isArray(items)) return inventoryJson;
    const missing = gifts.filter(item => !items.includes(item));
    return missing.length ? JSON.stringify([...items, ...missing]) : inventoryJson;
  } catch { return inventoryJson; }
}
