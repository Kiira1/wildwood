import { describe, expect, it } from "vitest";
import { GATHER_RESPAWN_FLOOR, gatherRespawnMs } from "./gather-respawn";
import { RESEARCH_DEFINITIONS } from "./research";

describe("gatherRespawnMs", () => {
  it("is the base time with no research", () => {
    expect(gatherRespawnMs(60, 0)).toBe(60_000);
    expect(gatherRespawnMs(120, undefined)).toBe(120_000);
  });

  it("takes 5% a rank off, 25% at rank 5", () => {
    expect(gatherRespawnMs(60, 1)).toBe(57_000);
    expect(gatherRespawnMs(60, 5)).toBe(45_000);
    expect(gatherRespawnMs(120, 5)).toBe(90_000);
    expect(gatherRespawnMs(900, 5)).toBe(675_000);
  });

  it("ignores ranks past the max and junk ranks", () => {
    expect(gatherRespawnMs(60, 50)).toBe(gatherRespawnMs(60, RESEARCH_DEFINITIONS.resourceRespawn.maxRank));
    expect(gatherRespawnMs(60, -3)).toBe(60_000);
    expect(gatherRespawnMs(60, Number.NaN)).toBe(60_000);
    expect(gatherRespawnMs(60, "5")).toBe(60_000);
  });

  it("never goes under the floor", () => {
    const { maxRank, valuePerRank } = RESEARCH_DEFINITIONS.resourceRespawn;
    expect(1 - maxRank * valuePerRank / 100).toBeGreaterThanOrEqual(GATHER_RESPAWN_FLOOR);
    expect(gatherRespawnMs(60, maxRank)).toBeGreaterThanOrEqual(60_000 * GATHER_RESPAWN_FLOOR);
  });
});
