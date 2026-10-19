import { describe, expect, it } from "vitest";
import { IRON_BOW, STARTER_STAFF, STARTER_STONE, WOODEN_SWORD } from "./items";
import { MASTERY_MAX_LEVEL, masteryLevel, masteryPointsForLevel, masteryPointsForReport, masteryProgress, weaponSchool } from "./weapon-mastery";

describe("weapon mastery", () => {
  it("trains the school of the weapon type in hand", () => {
    expect(weaponSchool(IRON_BOW)).toBe("archery");
    expect(weaponSchool(STARTER_STONE)).toBe("archery");
    expect(weaponSchool("")).toBe("archery");
    expect(weaponSchool(WOODEN_SWORD)).toBe("swordplay");
    expect(weaponSchool(STARTER_STAFF)).toBe("sorcery");
  });

  it("costs 1,000 points for level 1 and 11% more each level after", () => {
    expect(masteryPointsForLevel(1)).toBe(1_000);
    expect(masteryPointsForLevel(2)).toBe(2_110);
    expect(masteryPointsForLevel(10)).toBeCloseTo(16_720, -2);
    expect(masteryPointsForLevel(50)).toBeCloseTo(1_670_000, -4);
    expect(masteryPointsForLevel(99)).toBe(masteryPointsForLevel(MASTERY_MAX_LEVEL));
  });

  it("reads a level and the progress into it from points, stopping at the top", () => {
    expect(masteryLevel(0)).toBe(0);
    expect(masteryLevel(999)).toBe(0);
    expect(masteryLevel(1_000)).toBe(1);
    expect(masteryProgress(1_500)).toEqual({ level: 1, into: 500, needed: 1_110 });
    expect(masteryLevel(10n ** 12n)).toBe(MASTERY_MAX_LEVEL);
    expect(masteryProgress(10n ** 12n)).toEqual({ level: MASTERY_MAX_LEVEL, into: 0, needed: 0 });
    expect(masteryLevel(-5)).toBe(0);
  });

  it("pays a point a kill and 50 for a boss's first clear", () => {
    expect(masteryPointsForReport(7, false)).toBe(7);
    expect(masteryPointsForReport(0, true)).toBe(50);
    expect(masteryPointsForReport(NaN, false)).toBe(0);
  });
});
