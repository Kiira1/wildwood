import { regularMapLoot } from "../../shared/regular-map-loot";
import { installMapBalance } from "../../shared/map-balance-runtime";
import type { MapBalanceSnapshot } from "../../shared/map-balance-types";
import { MAP_IDS, WATER_REACH_MAP_ID } from "../../shared/rules";
import { describe, expect, it } from "vitest";
import {
  BASIC_PAPER_HAT,
  DARK_METAL_HELMET,
  FIRE_METAL_BOW,
  FIRE_METAL_HELMET,
  IRON_BOW,
  LAVA_HELMET_ITEM_DROP_DENOMINATOR,
  MAGMA_ARMOR,
  NIGHT_BOW,
  PAPER_HAT_DROP_DENOMINATOR,
  SNOW_BOW,
  WATER_ARMOR,
} from "../../shared/items";
import { TUTORIAL_FOREST_MAP_ID, createSpawnSites } from "../game/world";
import { mapGuideDropChance, mapGuideDrops, mapGuideItemStats, mapGuideZones } from "./map-guide-controller";

describe("map guide", () => {
  it("lists no gear on any map: only the forest's paper hat still drops", () => {
    expect(mapGuideDrops(TUTORIAL_FOREST_MAP_ID).map(({ itemId, denominator, source }) => [itemId, denominator, source]))
      .toEqual([[BASIC_PAPER_HAT, PAPER_HAT_DROP_DENOMINATOR, "Any regular enemy"]]);
    for (const mapId of MAP_IDS.filter(id => id !== TUTORIAL_FOREST_MAP_ID)) expect(mapGuideDrops(mapId as never)).toEqual([]);
    expect(mapGuideDropChance(25)).toBe("4%");
    expect(mapGuideDropChance(30)).toBe("3.3%");
    expect(mapGuideDropChance(1000, 7)).toBe("0.70%");
    expect(mapGuideDropChance(LAVA_HELMET_ITEM_DROP_DENOMINATOR)).toBe("0.80%");
  });

  it("shows every server drop and its exact chance", () => {
    for (const mapId of MAP_IDS) {
      expect(mapGuideDrops(mapId as never).map(drop => [drop.itemId, drop.numerator, drop.denominator])).toEqual(
        regularMapLoot(mapId).map(drop => [drop.itemId, drop.wins, drop.outcomes]),
      );
    }
  });

  it("leaves out gear a balance pinned before gear stopped dropping still lists", () => {
    installMapBalance({ mapId: WATER_REACH_MAP_ID, loot: [{ itemId: WATER_ARMOR, wins: 1, outcomes: 100 }] } as unknown as MapBalanceSnapshot);
    try {
      expect(mapGuideDrops(WATER_REACH_MAP_ID)).toEqual([]);
    } finally {
      installMapBalance(null);
    }
  });

  it("summarizes the stats players need when evaluating a drop", () => {
    expect(mapGuideItemStats(IRON_BOW)).toEqual(["Damage +8.04%"]);
    expect(mapGuideItemStats(MAGMA_ARMOR)).toEqual(["Max Health +15.18%"]);
    expect(mapGuideItemStats(FIRE_METAL_HELMET)).toEqual(["Regen +15.18%"]);
    expect(mapGuideItemStats(FIRE_METAL_BOW)).toEqual(["Damage +19.29%"]);
    expect(mapGuideItemStats(SNOW_BOW)).toEqual(["Damage +9.71%"]);
    expect(mapGuideItemStats(NIGHT_BOW)).toEqual(["Damage +16.39%"]);
    expect(mapGuideItemStats(DARK_METAL_HELMET)).toEqual(["Regen +19.29%"]);
  });

  it("groups live forest spawns into compact reward zones", () => {
    const zones = mapGuideZones(createSpawnSites({ x: 4_040, y: 4_040 }, TUTORIAL_FOREST_MAP_ID));
    expect(zones.find((zone) => zone.name === "Ember Fen")?.rewards.map((reward) => reward.label)).toEqual(["Max Health"]);
    expect(zones.find((zone) => zone.name === "Glass Thicket")?.rewards.map((reward) => reward.label)).toEqual(["Atk Speed"]);
    expect(zones.find((zone) => zone.name === "Cinder Quarry")?.rewards.map((reward) => reward.label)).toEqual(["Damage"]);
  });
});

describe("map guide browsing", () => {
  it("goes back to any map and forward to one past the furthest open", async () => {
    const { mapGuideBrowseRange } = await import("./map-guide-controller");
    const open = new Set(["tutorial_forest", "beginner_desert", "intermediate_snowlands"]);
    const { maps, last } = mapGuideBrowseRange((mapId) => open.has(mapId));
    expect(maps[last]).toBe("advanced_lava_wastes");
    // With the campaign done and two Endless maps open, the third is the last it shows.
    const { maps: all, last: end } = mapGuideBrowseRange((mapId) => !mapId.startsWith("endless_") || ["endless_1", "endless_2"].includes(mapId));
    expect(all[end]).toBe("endless_3");
    expect(all.length).toBe(end + 1);
  });
});
