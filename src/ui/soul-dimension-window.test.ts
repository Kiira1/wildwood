import { describe, expect, it } from "vitest";
import { EMPTY_SOUL_STATS } from "../../shared/soul-dimension";
import { RATING_MAX, ratingForLevels } from "../../shared/stat-rating";
import { soulValue } from "./soul-dimension-window";

describe("soul stat labels", () => {
  it("says Max once soul crit damage reaches the curve's top, as attack speed does", () => {
    expect(soulValue({ ...EMPTY_SOUL_STATS, critDamage: 100 }, "critDamage")).toBe("+0.27×");
    expect(soulValue({ ...EMPTY_SOUL_STATS, critDamage: ratingForLevels(400) }, "critDamage")).toBe("Max");
    expect(soulValue({ ...EMPTY_SOUL_STATS, critDamage: RATING_MAX }, "critDamage")).toBe("Max");
    expect(soulValue({ ...EMPTY_SOUL_STATS, attackSpeed: RATING_MAX }, "attackSpeed")).toBe("Max");
  });
});
