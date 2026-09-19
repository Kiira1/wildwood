import { describe, expect, it } from "vitest";
import { GEM_DROP_ODDS_ACTIVE, GEM_DROP_ODDS_IDLE, rollGemDrops } from "./gem-drops";
import { mapRandom } from "./procedural-maps";

describe("gem drops", () => {
  it("never awards more gems than accepted defeats", () => {
    expect(rollGemDrops(5, true, () => 0)).toBe(5);
    expect(rollGemDrops(5, true, () => 0.999)).toBe(0);
  });

  it("ignores counts the server did not accept", () => {
    for (const count of [0, -1, 1.5, Number.NaN]) expect(rollGemDrops(count, true, () => 0)).toBe(0);
  });

  it("pays active play at twice the idle rate", () => {
    expect(GEM_DROP_ODDS_IDLE / GEM_DROP_ODDS_ACTIVE).toBe(2);
    // A roll landing between the two thresholds wins only while active.
    const between = () => 1 / 1_500;
    expect(rollGemDrops(1, true, between)).toBe(1);
    expect(rollGemDrops(1, false, between)).toBe(0);
  });

  it("lands near the stated odds over a long seeded run", () => {
    const kills = 400_000;
    const active = rollGemDrops(kills, true, mapRandom(20260919));
    const idle = rollGemDrops(kills, false, mapRandom(20260919));
    expect(active).toBeGreaterThan(kills / GEM_DROP_ODDS_ACTIVE * 0.8);
    expect(active).toBeLessThan(kills / GEM_DROP_ODDS_ACTIVE * 1.2);
    expect(idle).toBeGreaterThan(kills / GEM_DROP_ODDS_IDLE * 0.8);
    expect(idle).toBeLessThan(kills / GEM_DROP_ODDS_IDLE * 1.2);
  });
});
