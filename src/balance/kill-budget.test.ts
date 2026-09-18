import { describe, expect, it } from "vitest";
import { bossHitsToDefeat } from "../../shared/boss-regeneration";
import { compareKillBudget, killTargets, minimumReadinessKills, DEFAULT_KILL_BUDGET } from "./kill-budget";

const input = { bossHp: 100_000, bossHitAfterArmor: 800, hitDamage: 100, health: 500,
  damagePerKill: 12, healthPerKill: 30, attackInterval: .4, firstHitSeconds: .2,
  targetSeconds: 90, maxHitShare: .3 };
describe("fixed-build boss kill budgets", () => {
  it("finds the first damage and health kill counts that cross both thresholds", () => {
    const result = minimumReadinessKills(input);
    const fightTime = (kills: number) => input.firstHitSeconds + (bossHitsToDefeat(input.bossHp,
      input.hitDamage + input.damagePerKill * kills, input.attackInterval) - 1) * input.attackInterval;
    expect(fightTime(result.damageKills!)).toBeLessThanOrEqual(input.targetSeconds);
    expect(fightTime(result.damageKills! - 1)).toBeGreaterThan(input.targetSeconds);
    expect(input.bossHitAfterArmor / (input.health + result.healthKills! * input.healthPerKill)).toBeLessThanOrEqual(.3);
    expect(input.bossHitAfterArmor / (input.health + (result.healthKills! - 1) * input.healthPerKill)).toBeGreaterThan(.3);
    expect(result.totalKills).toBe(result.damageKills! + result.healthKills!);
  });
  it("scales boss requirements to the selected kill budget including regeneration", () => {
    const result = compareKillBudget(input, { damage: 300, health: 140 });
    expect(result.proposed.damageKills).toBe(300);
    expect(result.proposed.healthKills).toBe(140);
    expect(result.proposed.totalKills).toBe(440);
    expect(result.current).toEqual(minimumReadinessKills(input));
    expect(result.bossHpMultiplier).toBeGreaterThan(1);
  });
  it("reports zero for a ready build and unreachable for a missing reward", () => {
    expect(minimumReadinessKills({ ...input, hitDamage: 1e9, health: 1e9 }).totalKills).toBe(0);
    const missing = minimumReadinessKills({ ...input, damagePerKill: 0 });
    expect(missing.damageKills).toBeNull(); expect(missing.totalKills).toBeNull();
  });
  it("continues the kill target at Ion into the independent Endless growth curve", () => {
    const ion = killTargets({ ...DEFAULT_KILL_BUDGET, curve: "custom" }, 14, 15);
    const first = killTargets({ ...DEFAULT_KILL_BUDGET, curve: "custom" }, 15, 15);
    expect(first.damage).toBeCloseTo(ion.damage * DEFAULT_KILL_BUDGET.endlessGrowth, -1);
    expect(killTargets({ ...DEFAULT_KILL_BUDGET, curve: "custom" }, 25, 15).damage).toBeGreaterThan(first.damage * 5);
  });
});
