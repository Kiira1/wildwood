import { describe, expect, it } from "vitest";
import { F32_STAT_LIMIT, narrowPower, narrowStat, needsWideStats, widePower, wideStatsApply } from "./wide-stats";
import { formatCompactNumber } from "./compact-number";

it("narrows to what an f32 column holds, never Infinity", () => {
  expect(narrowStat(5)).toBe(5);
  expect(narrowStat(1e40)).toBe(F32_STAT_LIMIT);
  expect(narrowStat(Infinity)).toBe(F32_STAT_LIMIT);
  expect(narrowStat(NaN)).toBe(0);
  expect(Number.isFinite(Math.fround(F32_STAT_LIMIT))).toBe(true);
});

it("lays wide values over only the fields that still agree", () => {
  const stats = { maxHp: Math.fround(F32_STAT_LIMIT), damage: 9, armor: Math.fround(F32_STAT_LIMIT), regen: 1 };
  const wide = { maxHp: 1e50, damage: 1e45, armor: 2e40, regen: 1 };
  expect(wideStatsApply(stats, wide)).toEqual({ maxHp: 1e50, damage: 9, armor: 2e40, regen: 1 });
  expect(wideStatsApply(stats, null)).toBe(stats);
  expect(needsWideStats({ maxHp: 1, damage: 4e38, armor: 0, regen: 0 })).toBe(true);
  expect(needsWideStats({ maxHp: 1, damage: 2e38, armor: 0, regen: 0 })).toBe(false);
});

describe("world chat's power column", () => {
  it("keeps a power past f32 readable, to the digits shown", () => {
    for (const power of [0, 95, 2.5e20, 2.9e38, 4.56e40, 1.23e60]) {
      const stored = Math.fround(narrowPower(power));
      expect(Number.isFinite(stored)).toBe(true);
      expect(formatCompactNumber(widePower(stored))).toBe(formatCompactNumber(power));
    }
  });
});
