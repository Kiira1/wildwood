import { describe, expect, it } from "vitest";
import { CRIT_CAP_CEILING, criticalDamage, criticalDamageMultiplier, critCapForRank, critMultiplierGainLabel, soulCritDamageBonus } from "./critical-damage";
import { soulCritRatingAfterKills } from "./soul-dimension";
import { RESEARCH_DEFINITIONS } from "./research";
import { RATING_MAX, critDamageForLevels, ratingForLevels } from "./stat-rating";

describe("critical damage", () => {
  it("is research and Keen Edge's old bonus from nothing, and a rating's level on the curve", () => {
    expect(criticalDamageMultiplier({})).toBeCloseTo(1.05);
    expect(criticalDamageMultiplier({ researchRank: 3, perks: { keenEdge: 5 } })).toBeCloseTo(1.05 + .15 + .6);
    // One level (100 rating): 3% of the way to 100x.
    expect(criticalDamageMultiplier({ rating: 100 })).toBeCloseTo(critDamageForLevels(1));
    // The soul adds what its own rating gives from nothing, flat, on top of the run's.
    expect(criticalDamage({ rating: 100, soul: 100 }).uncapped).toBeCloseTo(critDamageForLevels(1) + soulCritDamageBonus(100));
    expect(soulCritDamageBonus(100)).toBeCloseTo(critDamageForLevels(1) - 1.05);
  });

  it("pays a soul crit kill its whole 0.002x, however high the run's own crit is (the 0.901.49 report)", () => {
    for (const rating of [0, ratingForLevels(40), ratingForLevels(80)]) {
      let soul = soulCritRatingAfterKills(0, 2_000);
      const before = criticalDamage({ rating, soul, capRank: 5 }).uncapped;
      soul = soulCritRatingAfterKills(soul, 1);
      expect(criticalDamage({ rating, soul, capRank: 5 }).uncapped - before).toBeCloseTo(.002, 5);
    }
  });

  it("caps at 5×, 1× more a Crit Cap rank, up to 10× at the fifth", () => {
    expect([0, 1, 2, 3, 4, 5].map(critCapForRank)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(critCapForRank(9)).toBe(10);
    expect(critCapForRank(-1)).toBe(5);
    expect(critCapForRank(Number.NaN)).toBe(5);
    expect(CRIT_CAP_CEILING).toBe(10);
    expect(criticalDamageMultiplier({ soul: RATING_MAX })).toBe(5);
    expect(criticalDamageMultiplier({ soul: RATING_MAX, capRank: 2 })).toBe(7);
    // The curve only closes in on 10x.
    expect(criticalDamageMultiplier({ soul: RATING_MAX, capRank: 5 })).toBeCloseTo(10, 9);
    expect(criticalDamage({ rating: ratingForLevels(60), capRank: 1 })).toMatchObject({ multiplier: 6, cap: 6, capped: true });
    expect(criticalDamage({ rating: 100 })).toMatchObject({ capped: false });
  });

  it("never lets research and Keen Edge alone near the cap", () => {
    const most = criticalDamage({ researchRank: RESEARCH_DEFINITIONS.criticalDamage.maxRank, perks: { keenEdge: 5 } });
    expect(most.uncapped).toBeCloseTo(2.65);
    expect(criticalDamage({ researchRank: 1e6 }).research).toBeCloseTo(1);
  });

  it("splits the multiplier into the rating's, the soul's and research's shares", () => {
    const crit = criticalDamage({ rating: ratingForLevels(5), soul: ratingForLevels(6), researchRank: 20 });
    expect(crit.fromRating).toBeCloseTo(critDamageForLevels(5) - 1.05);
    expect(crit.fromSoul).toBeCloseTo(critDamageForLevels(6) - 1.05);
    expect(1.05 + crit.fromRating + crit.fromSoul + crit.fromBonuses).toBeCloseTo(crit.uncapped);
  });

  it("labels a crit kill by what it adds to the multiplier now, Capped at the cap", () => {
    const fresh = critMultiplierGainLabel({}, 100)!;
    expect(Number(fresh.slice(1, -1))).toBeCloseTo(critDamageForLevels(1) - 1.05, 2);
    const late = critMultiplierGainLabel({ rating: 100, capRank: 5 }, 100)!;
    expect(Number(late.slice(1, -1))).toBeLessThan(Number(fresh.slice(1, -1)));
    expect(critMultiplierGainLabel({ soul: RATING_MAX }, 100)).toBe("Capped");
  });
});

describe("crit damage cards", () => {
  it("raise the cap with the damage, so a capped player still gains from them", () => {
    const capped = { rating: RATING_MAX, capRank: 5 };
    expect(criticalDamageMultiplier(capped)).toBeCloseTo(CRIT_CAP_CEILING);
    const carded = criticalDamage({ ...capped, card: .15 });
    expect(carded.cap).toBeCloseTo(CRIT_CAP_CEILING * 1.15);
    expect(carded.multiplier).toBeCloseTo(CRIT_CAP_CEILING * 1.15);
    expect(critMultiplierGainLabel({ ...capped, card: .15 }, 100)).toBe("Capped");
  });
});
