import { bossBudgetScale } from "./boss-kill-budget";
import { describe, expect, it } from "vitest";
import { damageAfterArmor } from "./combat";
import { desertLaneCombatValue, desertLaneRewardValue, referenceBuildForMap, ENCOUNTER_PROFILES,
  DESERT_REFERENCE, FOREST_LANE_BASES, desertBossHealthAt, bossHeavyHitAt, MAP_STAT_GROWTH, CAMPAIGN_ENEMY_REWARD_MULTIPLIERS, CURRENT_ROLE_LANES, campaignEnemyRewardMultiplier, combatMultiplierForMap, damageCampRosterForMap } from "./progression";

describe("encounter experience contract", () => {
  it("awards 26.2553873832 health for a Desert regent", () => {
    expect(desertLaneRewardValue("King Slime", 0).amount).toBeCloseTo(26.2553873832, 8);
  });
  it("awards accelerated Desert health and armor for guards", () => {
    expect(desertLaneRewardValue("Bramble", 0).amount).toBeCloseTo(13.1276936916, 8);
    expect(desertLaneRewardValue("Mossback", 0).amount).toBeCloseTo(1.4586326324, 8);
  });
  it("awards 4.3758978972 damage for a Desert raider", () => {
    expect(desertLaneRewardValue("Cindermaw", 0).amount).toBeCloseTo(4.3758978972, 8);
  });
  it("awards 16.0449589564 damage for a Desert reaper", () => {
    const reward = desertLaneRewardValue("Dread Warden", 0);
    expect(reward.type).toBe("damage");
    expect(reward.amount).toBeCloseTo(16.0449589564, 10);
  });
  it("preserves reference fight length and affordable incoming hits at map entry", () => {
    for (let tier = 0; tier <= 15; tier++) {
      const build = referenceBuildForMap(tier);
      const previous = referenceBuildForMap(Math.max(0, tier - 1));
      const entry = { maxHp: Math.min(build.maxHp, previous.maxHp * 3), armor: Math.min(build.armor, previous.armor * 3) };
      for (const lane of Object.keys(ENCOUNTER_PROFILES) as Array<keyof typeof ENCOUNTER_PROFILES>) {
        const enemy = desertLaneCombatValue(lane, tier), reward = desertLaneRewardValue(lane, tier);
        const profile = ENCOUNTER_PROFILES[lane];
        expect(enemy.hp / (build.damage / build.attackInterval)).toBeCloseTo(profile.seconds);
        expect(damageAfterArmor(enemy.damage, entry.armor) / entry.maxHp).toBeCloseTo(profile.hitShare, 3);
        if (reward.type !== "speed") {
          const next = desertLaneRewardValue(lane, tier + 1);
          if (tier !== 1) expect(next.amount / reward.amount).toBeCloseTo((combatMultiplierForMap(tier + 1) / combatMultiplierForMap(tier)) * campaignEnemyRewardMultiplier(tier + 1) / campaignEnemyRewardMultiplier(tier), 8);
        }
      }
      expect(desertBossHealthAt(tier) / (build.damage / build.attackInterval * MAP_STAT_GROWTH)).toBeCloseTo(90 * bossBudgetScale(tier + 1).hpScale);
      expect(damageAfterArmor(bossHeavyHitAt(tier), build.armor * MAP_STAT_GROWTH) / (build.maxHp * MAP_STAT_GROWTH)).toBeCloseTo(.25 * bossBudgetScale(tier + 1).hitScale, 3);
    }
  });
  it("increases each campaign reward track per clear, including expanded damage camps", () => {
    for (const lane of Object.values(CURRENT_ROLE_LANES)) {
      for (let tier = 1; tier < CAMPAIGN_ENEMY_REWARD_MULTIPLIERS.length; tier++) {
        const amount = (index: number) => {
          if (desertLaneRewardValue(lane, index).type !== "damage") return desertLaneRewardValue(lane, index).amount;
          const roster = damageCampRosterForMap(index);
          return roster.raider * desertLaneRewardValue("Cindermaw", index).amount + roster.reaper * desertLaneRewardValue("Dread Warden", index).amount;
        };
        expect(amount(tier), `${lane} entering tier ${tier}`).toBeGreaterThan(amount(tier - 1));
      }
    }
  });
  it("isolates tutorial edits from campaign stats", () => {
    const before = desertLaneCombatValue("Bramble", 0);
    const saved = FOREST_LANE_BASES.Bramble.hp;
    try { FOREST_LANE_BASES.Bramble.hp *= 2; expect(desertLaneCombatValue("Bramble", 0)).toEqual(before); }
    finally { FOREST_LANE_BASES.Bramble.hp = saved; }
    expect(referenceBuildForMap(0).damage).toBe(DESERT_REFERENCE.damage);
  });
  it("lets future rosters add enemies without inflating the damage budget", () => {
    const payout = (roster: { raider: number; reaper: number }) =>
      desertLaneRewardValue("Cindermaw", 10, roster).amount * roster.raider +
      desertLaneRewardValue("Dread Warden", 10, roster).amount * roster.reaper;
    expect(payout({ raider: 12, reaper: 14 })).toBeCloseTo(payout({ raider: 6, reaper: 7 }));
    expect(payout({ raider: 20, reaper: 1 })).toBeCloseTo(payout({ raider: 6, reaper: 7 }));
  });
  it("rejects invalid tiers instead of emitting broken content", () => {
    for (const tier of [-1, .5, NaN, Infinity, 61]) expect(() => referenceBuildForMap(tier)).toThrow(RangeError);
  });
});
