import { describe, expect, it } from "vitest";
import { regularMapLoot } from "../../shared/regular-map-loot";
import { enemyDefeatDefinition } from "../../shared/enemy-defeats";
import { ENEMY_TYPES } from "../../shared/enemy-definitions";
import { createMapDefinitions } from "./simulator";
import { simulationTravelSeconds } from "./gameplay-model";

describe("simulator parity with gameplay", () => {
  it("models every current campaign drop and the server's elite eligibility", () => {
    for (const map of createMapDefinitions()) {
      expect(map.regularDrops.map(d => [d.itemId, d.numerator, d.denominator]), map.id)
        .toEqual(regularMapLoot(map.id).map(d => [d.itemId, d.wins, d.outcomes]));
      for (const enemy of Object.keys(ENEMY_TYPES) as (keyof typeof ENEMY_TYPES)[]) {
        const actual = enemyDefeatDefinition(map.id, enemy);
        for (const drop of map.regularDrops) expect(drop.eligible?.(enemy)).toBe(actual?.loot === true);
      }
    }
  });

  it("includes late-map gear and keeps fractional bow odds exact", () => {
    const maps = createMapDefinitions();
    expect(maps.find(m => m.id === "ion_citadel")!.regularDrops.map(d => d.itemId))
      .toEqual(["ion_bow", "ion_armor", "ion_helmet"]);
    const bow = maps.find(m => m.id === "samurai_garden")!.regularDrops.find(d => d.itemId === "samurai_bow")!;
    expect(bow.numerator! / bow.denominator).toBe(.0065);
  });

  it("only gives Black Boots' flat speed bonus after five seconds without combat", () => {
    expect(simulationTravelSeconds(900, 0, true, 0)).toBe(5);
    expect(simulationTravelSeconds(1105, 0, true, 0)).toBe(6);
    expect(simulationTravelSeconds(205, 0, true, 5)).toBe(1);
    expect(simulationTravelSeconds(205, 0, false, 100)).toBeCloseTo(205 / 180);
    // Research scales base speed; it does not multiply the flat boots bonus.
    expect(simulationTravelSeconds(241, 10, true, 5)).toBe(1);
  });
});
