import { expect, it } from "vitest";
import { itemTier } from "./item-tier";
import { CAMPAIGN_EQUIPMENT } from "./campaign-equipment";
import { MAP_IDS } from "./rules";
import { regularMapLoot } from "./regular-map-loot";
it("keeps each old item's source map tier across all fifteen campaign maps, though nothing drops it now", () => {
  for (const [itemId, { mapId }] of Object.entries(CAMPAIGN_EQUIPMENT)) expect(itemTier(itemId), itemId).toBe(MAP_IDS.indexOf(mapId) + 1);
  expect(itemTier("ion_bow")).toBe(15);
  for (const [id, tier] of [["starter_bow", 1], ["wooden_armor", 1], ["iron_bow", 2], ["wood_full_helm", 2], ["snow_bow", 3],
    ["magma_armor", 4], ["black_boots", 5], ["sky_bow", 6], ["samurai_hat", 7], ["cloudspire_bow", 8], ["moonfen_armor", 9]] as const) {
    expect(itemTier(id), id).toBe(tier);
  }
  expect(itemTier("frost_bow")).toBe(3);
  expect(itemTier("frost_armor")).toBe(3);
  expect(itemTier("lava_bow")).toBe(4);
  expect(itemTier("starter_stone")).toBe(1);
  // Nothing with a tier still drops.
  for (const mapId of MAP_IDS) for (const drop of regularMapLoot(mapId)) expect(itemTier(drop.itemId)).toBeUndefined();
});
it("does not invent tiers for cosmetics, dev gear, or unknown items", () => {
  for (const id of ["superior_golden_helmet", "basic_paper_hat", "galaxy_bow", "unknown"]) expect(itemTier(id)).toBeUndefined();
});
