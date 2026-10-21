import { regularMapLoot } from "../../shared/regular-map-loot";
import { installMapBalance } from "../../shared/map-balance-runtime";
import type { MapBalanceSnapshot } from "../../shared/map-balance-types";
import { MAP_IDS, WATER_REACH_MAP_ID } from "../../shared/rules";
import { describe, expect, it } from "vitest";
import { WATER_ARMOR } from "../../shared/items";
import { mapGuideDrops } from "./map-guide-controller";

describe("map guide", () => {
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
});
