import { describe, expect, it } from "vitest";
import { bossHitsToDefeat } from "../../shared/boss-regeneration";
import { generatedBossStats } from "../../shared/procedural-maps";
import { BOSS_TARGET_SECONDS } from "../../shared/progression";
import { MAX_PLAYER_STAT, MIN_ATTACK_INTERVAL } from "../../shared/rules";
import { CURVE_STEPS } from "../../shared/curve-steps";
import { endlessPacing } from "./endless-pacing";

describe("Endless advancement effort", () => {
  it("requires more damage farming at every depth after the campaign handoff", () => {
    let previous = endlessPacing(2);
    // Until the boss reaches the stat ceiling (around Endless 850), where it stops growing.
    for (let number = 3; generatedBossStats({ number }).hp < MAX_PLAYER_STAT; number++) {
      const next = endlessPacing(number);
      expect(next.extraDamage, `Endless ${number}`).toBeGreaterThan(previous.extraDamage);
      expect(next.damageKills, `Endless ${number}`).toBeGreaterThan(previous.damageKills);
      previous = next;
    }
  });
  it("needs the health step over the reward step more damage kills each map, for a fixed build", () => {
    for (const number of [2, 10, 40]) {
      expect(endlessPacing(number + 1).damageKills / endlessPacing(number).damageKills).toBeCloseTo(CURVE_STEPS.health / CURVE_STEPS.reward, 1);
    }
  });
  it("uses the actual boss regeneration and carries forward the previous build without a boss payout", () => {
    for (const number of [1, 2, 10, 40]) {
      const row = endlessPacing(number);
      expect(row.extraDamage).toBeGreaterThan(0);
      const seconds = (bossHitsToDefeat(generatedBossStats({ number }).hp, row.targetDamage * (1 + 1e-12), MIN_ATTACK_INTERVAL) - 1) * MIN_ATTACK_INTERVAL;
      expect(seconds).toBeLessThanOrEqual(BOSS_TARGET_SECONDS);
      expect(seconds).toBeGreaterThan(BOSS_TARGET_SECONDS - MIN_ATTACK_INTERVAL * 2);
    }
  });
});
