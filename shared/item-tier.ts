import { FROST_ARMOR, FROST_BOW, LAVA_BOW, STARTER_STONE, isCosmeticOnlyItem } from "./items";
import { regularMapLoot } from "./regular-map-loot";
import { MAP_IDS } from "./rules";

// Tier follows the source map, not item power or upgrade level. Build once so
// inventory/profile renders do not repeatedly search every map's drop list.
const TIERS = new Map<string, number>([[STARTER_STONE, 1], [FROST_ARMOR, 3], [FROST_BOW, 3], [LAVA_BOW, 4]]);
MAP_IDS.forEach((mapId, index) => {
  for (const { itemId } of regularMapLoot(mapId)) if (!TIERS.has(itemId)) TIERS.set(itemId, index + 1);
});
export function itemTier(itemId: string): number | undefined {
  return isCosmeticOnlyItem(itemId) ? undefined : TIERS.get(itemId);
}
