import { describe, expect, it } from "vitest";
import type { Identity } from "spacetimedb";
import { remoteCombatStatsFromRows } from "./remote-combat-stats-service";

const identity = {} as Identity;

describe("remote combat stats", () => {
  it("shows a sword as one melee hit at its weapon range without changing saved stats", () => {
    const progress = { identity, maxHp: 100, damage: 10, attackRate: 1, projectileSpeed: 1000,
      projectileCount: 5, attackRange: 200, armor: 0, regen: 0, equippedHead: "", equippedChest: "",
      equippedRightHand: "wooden_sword", equippedLeftHand: "" };
    expect(remoteCombatStatsFromRows(progress, null, [])).toMatchObject({ melee: true, attackRange: 75, projectileCount: 1, damage: 10 });
    expect(progress.attackRange).toBe(200);
    expect(remoteCombatStatsFromRows({ ...progress, equippedRightHand: "starter_bow" }, null, []))
      .toMatchObject({ melee: false, attackRange: 200, projectileCount: 5 });
  });
  it("uses the same saved-stat, research, and projectile values as local combat", () => {
    const stats = remoteCombatStatsFromRows({
      identity,
      maxHp: 500,
      damage: 100,
      attackRate: 1.2,
      projectileSpeed: 780,
      projectileCount: 3,
      attackRange: 280,
      armor: 100,
      regen: 5,
      equippedHead: "",
      equippedChest: "",
      equippedRightHand: "",
      equippedLeftHand: "",
    }, {
      identity,
      warcraft: 5,
      precision: 2,
      regeneration: 3,
      criticalChance: 7,
      criticalDamage: 4,
    }, []);

    expect(stats).toMatchObject({
      maxHp: 500,
      armor: 104,
      attackInterval: 1.2,
      projectileSpeed: 780,
      projectileCount: 3,
      attackRange: 280,
      criticalChance: .07,
      criticalDamageMultiplier: 1.25,
    });
    expect(stats.damage).toBeCloseTo(110);
    expect(stats.regen).toBeCloseTo(5.3);
  });
});
