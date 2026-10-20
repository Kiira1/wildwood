import { SUPERIOR_GOLDEN_HELMET } from "./items";

export const ALPHA_TESTER_GIFT_CAMPAIGN = "alpha-testers-2026-09-13";
export const ALPHA_TESTER_GIFT_ITEM = SUPERIOR_GOLDEN_HELMET;
// September 13 in America/Los_Angeles, matching the developer's local date.
export const ALPHA_TESTER_REGISTRATION_START = 1_789_282_800_000_000n;
export const ALPHA_TESTER_REGISTRATION_END = ALPHA_TESTER_REGISTRATION_START + 86_400_000_000n;
export type PendingItemGift = { key: string; itemId: string };
