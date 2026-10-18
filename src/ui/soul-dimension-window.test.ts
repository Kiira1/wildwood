import { describe, expect, it } from "vitest";
import { EMPTY_SOUL_STATS } from "../../shared/soul-dimension";
import { RATING_MAX, ratingForLevels } from "../../shared/stat-rating";
import { soulValue } from "./soul-dimension-window";
import { soulLevelText } from "./soul-level-hud";

describe("soul stat labels", () => {
  it("says Max once soul crit damage reaches the curve's top, as attack speed does", () => {
    expect(soulValue({ ...EMPTY_SOUL_STATS, critDamage: 100 }, "critDamage")).toBe("+0.27×");
    expect(soulValue({ ...EMPTY_SOUL_STATS, critDamage: ratingForLevels(400) }, "critDamage")).toBe("Max");
    expect(soulValue({ ...EMPTY_SOUL_STATS, critDamage: RATING_MAX }, "critDamage")).toBe("Max");
    expect(soulValue({ ...EMPTY_SOUL_STATS, attackSpeed: RATING_MAX }, "attackSpeed")).toBe("Max");
  });
});

describe("Soul Level text", () => {
  it("shows the level, the reward multiplier and the XP toward the next level", () => {
    expect(soulLevelText({ level: 3, xp: 1_240, needed: 2_700, multiplier: 4, max: false })).toEqual({
      level: "Soul Lv 3", rewards: "4×", xp: "1,240 / 2,700 Soul XP", shortXp: "1.24k / 2.70k", fill: 1_240 / 2_700,
    });
    expect(soulLevelText({ level: 10, xp: 0, needed: 0, multiplier: 512, max: true })).toMatchObject({ rewards: "512×", xp: "Max Level", fill: 1 });
  });
});
