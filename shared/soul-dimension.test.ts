import { challengeMinimumInterval } from "./prestige-challenge";
import { RATING_MAX, attackIntervalForRating, attackSpeedRatingForInterval } from "./stat-rating";
import { describe, expect, it } from "vitest";
import {
  addSoulXp, cleanSoulLevel, mergeSoulLevels, soulLevelTotalXp, soulLevelXpNeeded, soulRewardMultiplier, SOUL_LEVEL_BASE_XP, SOUL_LEVEL_CAP, SOUL_LEVEL_GROWTH,
  addSoulKills, cleanSoulStats, EMPTY_SOUL_STATS, soulAttackSpeedBonus, soulAttackSpeedRatingAfterKills, soulCritRatingAfterKills, soulDimensionAccess, soulEnemyStats, soulStatsUnlocked, soulTier, soulTierKillsNeeded, withSoulStats, withoutSoulStats, SOUL_CAMPS, SOUL_POPULATION, SOUL_TIER_KILL_TYPES,
} from "./soul-dimension";
import { MIN_ATTACK_INTERVAL } from "./rules";
import { decodePlayerMapFrame, decodePlayerMotionFrame, encodePlayerMapFrame, encodePlayerMotionFrame } from "./player-motion-frame";
import { critDamageForLevels, critDamageLevelsFor, ratingForLevels, ratingLevels } from "./stat-rating";

const each = (count: number) => ({ damage: count, health: count, armor: count, regen: count, speed: count });

describe("soul tiers", () => {
  it("needs 5^(N+1) kills of every reward type for tier N", () => {
    expect([1, 2, 3, 4, 5, 6].map(soulTierKillsNeeded)).toEqual([25, 125, 625, 3_125, 15_625, 78_125]);
    expect(soulTier(each(24))).toBe(0);
    expect(soulTier(each(25))).toBe(1);
    expect(soulTier(each(124))).toBe(1);
    expect(soulTier(each(125))).toBe(2);
    expect(soulTier(each(10_000_000))).toBe(6);
  });

  it("counts the fewest type: one type behind holds the tier back", () => {
    expect(soulTier({ ...each(1_000), armor: 30 })).toBe(1);
    expect(soulTier({ ...each(1_000), regen: 0 })).toBe(0);
  });

  it("asks nothing of attack speed enemies: few maps have them", () => {
    expect(SOUL_TIER_KILL_TYPES).toEqual(["damage", "health", "armor", "regen"]);
    expect(soulTier({ ...each(1_000), speed: 0 })).toBe(soulTier(each(1_000)));
  });

  it("wakes the soul enemies in order: damage, health, armor, regen, attack speed, crit damage", () => {
    expect(soulStatsUnlocked(0)).toEqual([]);
    expect(soulStatsUnlocked(1)).toEqual(["damage"]);
    expect(soulStatsUnlocked(6)).toEqual(["damage", "health", "armor", "regen", "attackSpeed", "critDamage"]);
  });
});

describe("soul stats", () => {
  it("pay a flat amount a kill that never grows", () => {
    let soul = addSoulKills(null, "damage", 10);
    soul = addSoulKills(soul, "health", 3);
    soul = addSoulKills(soul, "critDamage", 5);
    expect(soul.damage).toBe(10);
    // Health pays ten a kill, ten times Damage's one.
    expect(soul.maxHp).toBe(30);
    // Crit damage is a rating, paid at 0.002x a kill: five kills from nothing is 1.06x.
    expect(critDamageForLevels(ratingLevels(soul.critDamage))).toBeCloseTo(1.06, 9);
  });

  it("add to a run's base stats, attack speed flat on top of the run's, never past the cap nor slowing a faster run", () => {
    const run = { damage: 10, maxHp: 100, armor: 5, regen: 1, attackRate: attackIntervalForRating(200) };
    const soulSpeed = soulAttackSpeedRatingAfterKills(0, 100);
    const boosted = withSoulStats(run, { damage: 2, maxHp: 50, armor: 1, regen: .5, attackSpeed: soulSpeed });
    expect(boosted).toMatchObject({ damage: 12, maxHp: 150, armor: 6, regen: 1.5 });
    // A hundred soul kills: 0.1 attacks a second more, whatever the run's own rating.
    expect(1 / boosted.attackRate - 1 / run.attackRate).toBeCloseTo(.1, 9);
    expect(withSoulStats(run, { attackSpeed: RATING_MAX }).attackRate).toBeCloseTo(MIN_ATTACK_INTERVAL);
    const challenge = { ...run, attackRate: MIN_ATTACK_INTERVAL * .8 };
    expect(withSoulStats(challenge, { attackSpeed: 1 }).attackRate).toBe(challenge.attackRate);
    expect(withSoulStats(run, null)).toBe(run);
  });

  it("let attack speed reach the cap Reflect Only wins raise, and undo exactly under it", () => {
    // Two wins: the base cap plus a whole attack a second, and a run already at the base cap.
    const cap = challengeMinimumInterval({ active: false, completed: 2 });
    const run = { damage: 10, maxHp: 100, armor: 5, regen: 1, attackRate: attackIntervalForRating(400, cap) };
    const soulSpeed = soulAttackSpeedRatingAfterKills(0, 100);
    const boosted = withSoulStats(run, { attackSpeed: soulSpeed }, cap);
    expect(1 / boosted.attackRate - 1 / run.attackRate).toBeCloseTo(.1, 9);
    expect(attackSpeedRatingForInterval(boosted.attackRate, cap)).toBeGreaterThan(400);
    expect(withSoulStats(run, { attackSpeed: RATING_MAX }, cap).attackRate).toBeCloseTo(cap);
    expect(withoutSoulStats(boosted, { attackSpeed: soulSpeed }, 9, cap).attackRate).toBeCloseTo(run.attackRate, 9);
    // At the cap it cannot be undone exactly, so the saved interval stands.
    expect(withoutSoulStats({ ...run, attackRate: cap }, { attackSpeed: soulSpeed }, .7, cap).attackRate).toBe(.7);
  });
});

describe("soul enemies", () => {
  it("are built at the player's strength: tougher and harder-hitting as the player grows", () => {
    const weak = soulEnemyStats({ dps: 10, maxHp: 100, armor: 0, regen: 1 });
    const strong = soulEnemyStats({ dps: 1_000, maxHp: 10_000, armor: 0, regen: 100 });
    expect(strong.hp / weak.hp).toBeCloseTo(100);
    expect(strong.damage / weak.damage).toBeCloseTo(100);
  });

  it("hit through armor as hard as before it, so armor never makes them free", () => {
    const bare = soulEnemyStats({ dps: 10, maxHp: 1_000, armor: 0, regen: 0 });
    const armored = soulEnemyStats({ dps: 10, maxHp: 1_000, armor: 1_000, regen: 0 });
    expect(armored.damage).toBeCloseTo(bare.damage * 2);
  });
});

describe("the soul forest", () => {
  it("holds Tutorial Forest's camps, every one of them, and as many enemies as the forest has", () => {
    expect(SOUL_CAMPS.length).toBeGreaterThan(5);
    expect(new Set(SOUL_CAMPS.map(camp => camp.key)).size).toBe(SOUL_CAMPS.length);
    expect(SOUL_POPULATION).toBe(SOUL_CAMPS.reduce((sum, camp) => sum + camp.count, 0));
    for (const camp of SOUL_CAMPS) { expect(camp.roll).toBeGreaterThanOrEqual(0); expect(camp.roll).toBeLessThan(1); }
  });
});

describe("Soul Dimension access", () => {
  it("is the developer's alone until opened, and always needs a prestige", () => {
    expect(soulDimensionAccess({ open: false, developer: false, prestigeLevel: 5 })).toBe("closed");
    expect(soulDimensionAccess({ open: false, developer: true, prestigeLevel: 1 })).toBe("open");
    expect(soulDimensionAccess({ open: true, developer: false, prestigeLevel: 0 })).toBe("locked");
    expect(soulDimensionAccess({ open: true, developer: false, prestigeLevel: 1 })).toBe("open");
  });
});

describe("wide motion frames", () => {
  it("carry Town positions far past u16, and stay apart from the narrow format", () => {
    const motion = [{ networkId: 7, x: 512_345.6, y: 499_999.9, vx: -240.5, vy: 12, simulationTick: 70_000, motionEpoch: 3 }];
    const wide = encodePlayerMotionFrame(motion, true);
    expect(wide.byteLength).toBe(20);
    const [decoded] = decodePlayerMotionFrame(wide, 1);
    expect(decoded.x).toBeCloseTo(512_345.6, 1);
    expect(decoded.y).toBeCloseTo(499_999.9, 1);
    expect(decoded.vx).toBeCloseTo(-240.5, 1);
    expect(decoded.simulationTick).toBe(70_000 & 0xffff);
    const narrow = decodePlayerMotionFrame(encodePlayerMotionFrame([{ ...motion[0], x: 1_000, y: 2_000 }]), 1)[0];
    expect([narrow.x, narrow.y]).toEqual([1_000, 2_000]);
    const map = decodePlayerMapFrame(encodePlayerMapFrame([{ networkId: 9, x: 777_777.7, y: 3 }], true), 1)[0];
    expect(map.x).toBeCloseTo(777_777.7, 1);
  });
});

it("keeps soul attack speed and crit damage as rating points, never past the rating's top", () => {
  expect(soulAttackSpeedBonus(addSoulKills(EMPTY_SOUL_STATS, "attackSpeed", 3).attackSpeed)).toBeCloseTo(.003, 9);
  expect(addSoulKills({ ...EMPTY_SOUL_STATS, critDamage: RATING_MAX }, "critDamage", 10).critDamage).toBe(RATING_MAX);
  expect(cleanSoulStats({ attackSpeed: 1e305 }).attackSpeed).toBe(RATING_MAX);
});

describe("soul crit damage at the old pace (0.901.47.1)", () => {
  it("adds 0.002x crit damage a kill even near the curve's top, where a point of rating did nothing", () => {
    const at5 = ratingForLevels(critDamageLevelsFor(5));
    expect(critDamageForLevels(ratingLevels(soulCritRatingAfterKills(at5, 1)))).toBeCloseTo(5.002, 6);
    expect(critDamageForLevels(ratingLevels(soulCritRatingAfterKills(at5, 1_000)))).toBeCloseTo(7, 6);
    // 5x to the 10x top is 2,500 kills.
    expect(soulCritRatingAfterKills(at5, 2_500)).toBe(RATING_MAX);
    expect(critDamageForLevels(ratingLevels(soulCritRatingAfterKills(at5, 2_490)))).toBeLessThan(10);
  });
});

describe("soul attack speed at the old pace (0.901.55)", () => {
  it("adds 0.001 attacks a second a kill, flat, however much the soul or the run already has", () => {
    expect(soulAttackSpeedBonus(soulAttackSpeedRatingAfterKills(0, 1))).toBeCloseTo(.001, 9);
    const at2 = soulAttackSpeedRatingAfterKills(0, 2_000);
    expect(soulAttackSpeedBonus(at2)).toBeCloseTo(2, 6);
    expect(soulAttackSpeedBonus(soulAttackSpeedRatingAfterKills(at2, 1)) - soulAttackSpeedBonus(at2)).toBeCloseTo(.001, 6);
    // A fresh character's whole gap to the base cap of 3 a second is 2,360 kills, as before 0.901.47.
    const fresh = { damage: 1, maxHp: 1, armor: 0, regen: 0, attackRate: 1 / .641 };
    expect(1 / withSoulStats(fresh, { attackSpeed: soulAttackSpeedRatingAfterKills(0, 2_360) }).attackRate).toBeCloseTo(3, 2);
  });

  it("leaves a soul that was farmed to the top at the top: anyone's own cap", () => {
    expect(soulAttackSpeedBonus(RATING_MAX)).toBe(Number.POSITIVE_INFINITY);
    // Past the base cap's 2.36 a second, a soul is Max.
    expect(soulAttackSpeedRatingAfterKills(0, 2_400)).toBe(RATING_MAX);
    expect(soulAttackSpeedRatingAfterKills(RATING_MAX, 5)).toBe(RATING_MAX);
    const fresh = { damage: 1, maxHp: 1, armor: 0, regen: 0, attackRate: 1 / .641 };
    expect(withSoulStats(fresh, { attackSpeed: RATING_MAX }).attackRate).toBeCloseTo(MIN_ATTACK_INTERVAL, 9);
  });
});

describe("the Soul Level", () => {
  it("needs 300 Soul XP for level 2 and 1.5 times as much for each level after, rounded, up to level 50", () => {
    expect([SOUL_LEVEL_BASE_XP, SOUL_LEVEL_GROWTH, SOUL_LEVEL_CAP]).toEqual([300, 1.5, 50]);
    expect([1, 2, 3, 4, 5, 9, 49].map(soulLevelXpNeeded)).toEqual([300, 450, 675, 1_013, 1_519, 7_689, 85_016_200_029]);
    expect(soulLevelXpNeeded(SOUL_LEVEL_CAP)).toBe(0);
    expect(soulLevelTotalXp({ level: 10, xp: 0 })).toBe(22_467);
    expect(soulLevelTotalXp({ level: SOUL_LEVEL_CAP, xp: 0 })).toBe(255_048_599_487);
  });

  it("levels up as Soul XP comes in, carrying the rest, and stops at the cap", () => {
    expect(addSoulXp(null, 299)).toEqual({ level: 1, xp: 299 });
    expect(addSoulXp(null, 300)).toEqual({ level: 2, xp: 0 });
    expect(addSoulXp({ level: 1, xp: 290 }, 30)).toEqual({ level: 2, xp: 20 });
    expect(addSoulXp(null, 750 + 5)).toEqual({ level: 3, xp: 5 });
    expect(addSoulXp(null, 1e12)).toEqual({ level: SOUL_LEVEL_CAP, xp: 0 });
    expect(addSoulXp({ level: SOUL_LEVEL_CAP, xp: 0 }, 50)).toEqual({ level: SOUL_LEVEL_CAP, xp: 0 });
    expect(cleanSoulLevel({ level: 99, xp: 5 })).toEqual({ level: SOUL_LEVEL_CAP, xp: 0 });
    expect(cleanSoulLevel({ level: 0, xp: -3 })).toEqual({ level: 1, xp: 0 });
  });

  it("doubles the reward multiplier every level: 1×, 2×, 4× … 2^49× at the cap", () => {
    expect([1, 2, 3, 4, 10, 20, 50, 51].map(soulRewardMultiplier)).toEqual([1, 2, 4, 8, 512, 524_288, 2 ** 49, 2 ** 49]);
  });

  it("pays each soul stat its reward times the multiplier, rating stats included", () => {
    for (const multiplier of [2, 4, 512]) {
      const doubled = (stat: Parameters<typeof addSoulKills>[1]) => addSoulKills(EMPTY_SOUL_STATS, stat, 3, multiplier);
      const plain = (stat: Parameters<typeof addSoulKills>[1]) => addSoulKills(EMPTY_SOUL_STATS, stat, 3 * multiplier);
      expect(doubled("damage").damage).toBe(3 * multiplier);
      expect(doubled("health").maxHp).toBe(30 * multiplier);
      expect(doubled("armor").armor).toBe(3 * multiplier);
      expect(doubled("regen").regen).toBeCloseTo(.3 * multiplier, 9);
      expect(doubled("attackSpeed").attackSpeed).toBe(plain("attackSpeed").attackSpeed);
      expect(doubled("critDamage").critDamage).toBe(plain("critDamage").critDamage);
    }
    // Two kills at level 2 add what four kills at level 1 do.
    expect(soulAttackSpeedBonus(addSoulKills(EMPTY_SOUL_STATS, "attackSpeed", 2, 2).attackSpeed)).toBeCloseTo(.004, 9);
    const crit = (rating: number) => critDamageForLevels(ratingLevels(rating));
    expect(crit(addSoulKills(EMPTY_SOUL_STATS, "critDamage", 1, 4).critDamage) - crit(0)).toBeCloseTo(.008, 3);
  });

  it("adds a guest's level onto an account's by their Soul XP, never below the higher level", () => {
    expect(mergeSoulLevels({ level: 2, xp: 100 }, { level: 1, xp: 250 })).toEqual({ level: 2, xp: 350 });
    expect(mergeSoulLevels({ level: 1, xp: 200 }, { level: 1, xp: 200 })).toEqual({ level: 2, xp: 100 });
    expect(mergeSoulLevels(null, { level: 4, xp: 9 })).toEqual({ level: 4, xp: 9 });
  });
});
