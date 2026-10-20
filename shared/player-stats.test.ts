import { describe, expect, it } from "vitest";
import { BLACK_BOOTS, FROST_BOW, STARTER_STONE } from "./items";
import { luckMultiplier } from "./luck-research";
import { blackBootsSpeed, computePlayerStats, type PlayerStatInputs } from "./player-stats";
import { PLAYER_SPEED } from "./rules";

const inputs = (extra: Partial<PlayerStatInputs> = {}): PlayerStatInputs => ({
  base: { maxHp: 100, damage: 20, armor: 10, regen: 2, attackInterval: 1, attackRange: 200, moveSpeed: PLAYER_SPEED },
  loadout: { head: "", chest: "", feet: "", rightHand: "", leftHand: "" },
  ...extra,
});

describe("Black Boots", () => {
  it("add exactly 25 speed, in combat or out of it, and nothing in duels", () => {
    expect(blackBootsSpeed(BLACK_BOOTS)).toBe(25);
    expect(blackBootsSpeed(STARTER_STONE)).toBe(0);
    expect(blackBootsSpeed("")).toBe(0);
    expect(blackBootsSpeed(BLACK_BOOTS, true)).toBe(0);
  });

  it("count in move speed outside duels", () => {
    const loadout = { head: "", chest: "", feet: BLACK_BOOTS, rightHand: "", leftHand: "" };
    expect(computePlayerStats(inputs({ loadout })).moveSpeed).toBe(PLAYER_SPEED + 25);
    expect(computePlayerStats(inputs({ loadout, dueling: true })).moveSpeed).toBe(PLAYER_SPEED);
  });
});

describe("computePlayerStats", () => {
  it("splits gear into bare equipment, what slot tiers add and what refines add", () => {
    const loadout = { head: "", chest: "", feet: "", rightHand: FROST_BOW, leftHand: "" };
    const stats = computePlayerStats(inputs({ loadout, itemLevel: () => ({ tier: 10, refine: 5 }) }));
    const { equipment, slotUpgrade, refine } = stats.sources.damage;
    expect(slotUpgrade).toBeGreaterThan(0);
    expect(refine).toBeGreaterThan(0);
    expect(stats.damage).toBeCloseTo(20 * (1 + equipment + slotUpgrade + refine) * stats.sources.damage.classSet, 9);
  });

  it("keeps attacks under the cap and raises the gold chance with Gold Luck", () => {
    const stats = computePlayerStats(inputs({ base: { ...inputs().base, attackInterval: .01 }, goldLuckRank: 3 }));
    expect(stats.attackInterval).toBe(stats.capInterval);
    expect(stats.goldChanceMultiplier).toBeCloseTo(luckMultiplier("gearLuck", 3));
  });
});
