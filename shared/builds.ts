import { cardDefinition } from "./cards";

/** How many Builds a player can save. */
export const BUILD_SLOTS = 3;

export type BuildGear = { HEAD: string; CHEST: string; FEET: string; HAND: string };
/** A saved build as the client reads it: the gear in each slot and the cards in each item. */
export type SavedBuild = { slot: number; gear: BuildGear; cards: Record<string, string[]> };
export const BUILD_GEAR_SLOTS = ["HAND", "HEAD", "CHEST", "FEET"] as const;
const EMPTY_GEAR: BuildGear = { HEAD: "", CHEST: "", FEET: "", HAND: "" };

/** A saved build's gear, with anything malformed read as an empty slot. */
export function parseBuildGear(text: string): BuildGear {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object") return { ...EMPTY_GEAR };
    return Object.fromEntries(BUILD_GEAR_SLOTS.map(slot => [slot, typeof value[slot] === "string" ? value[slot] : ""])) as BuildGear;
  } catch { return { ...EMPTY_GEAR }; }
}

/** A saved build's cards by item, real cards only. */
export function parseBuildCards(text: string): Record<string, string[]> {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(Object.entries(value)
      .filter(([, cards]) => Array.isArray(cards))
      .map(([itemId, cards]) => [itemId, (cards as unknown[]).filter((cardId): cardId is string => typeof cardId === "string" && Boolean(cardDefinition(cardId)))]));
  } catch { return {}; }
}
