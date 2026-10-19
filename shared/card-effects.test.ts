import { describe, expect, it } from "vitest";
import {
  CARD_CHANCE_CAP, CARD_DODGE_CAP, CARD_GUARD_CAP, NO_CARDS, cardChance, cardDamageDealtMultiplier, cardDamageTakenMultiplier,
  cardStatFactors, cardTotals, cardValue,
} from "./card-effects";
import { criticalDamage } from "./critical-damage";
import { cardStatGainFactor, respawnSecondsWithCards } from "./card-effects";
import { applyEnemyRewards } from "./enemy-defeats";
import { MINING_NODES, MINING_STARSHARD_CHANCE, miningBreakSeconds, miningYield } from "./mining";
import { effectiveRewardAmount } from "./reward-display";
import { effectivePlayerPowerStats } from "./player-power";

describe("card totals", () => {
  it("adds up stats and costs, and skips unknown cards", () => {
    const totals = cardTotals(["spitter_card", "spitter_card", "ember_raider_card", "not_a_card"]);
    // Spitter +2% damage twice; Ember Raider (map 4) +2x damage, -1x max health.
    expect(cardValue(totals, "atk")).toBeCloseTo(2 + 2 + 4.9, 5);
    expect(cardValue(totals, "maxHealth")).toBeCloseTo(-3.6, 5);
    expect(cardTotals([])).toBe(NO_CARDS);
  });

  it("keeps map cards and bounties by their map and stat", () => {
    const totals = cardTotals(["dune_raider_card", "dune_regent_card", "seed_spitter_card"]);
    expect(totals.raceSlayer).toEqual({ beginner_desert: 9 });
    expect(Object.keys(totals.raceGuard)).toEqual(["beginner_desert"]);
    expect(totals.statGain.health).toBeGreaterThan(0);
    expect(cardValue(totals, "raceSlayer")).toBe(0);
  });

  it("rolls procs on their own: equal ones add chances under the cap, a boss card's every-hit one stays apart and always fires", () => {
    const burns = cardTotals(["cindermaw_card", "cindermaw_card", "magmalisk_card"]).procs.filter(proc => proc.effect === "burn");
    expect(burns).toHaveLength(2);
    expect(burns.find(proc => proc.share === undefined)?.chance).toBeCloseTo(6, 5);
    expect(burns.find(proc => proc.share === .3)).toMatchObject({ chance: 100, always: true });
    // Copies of a burn on every hit stack: three Magmalisk cards burn 90% of the hit.
    const magmalisks = cardTotals(["magmalisk_card", "magmalisk_card", "magmalisk_card"]).procs.filter(proc => proc.effect === "burn");
    expect(magmalisks).toHaveLength(1);
    expect(magmalisks[0]).toMatchObject({ chance: 100, always: true });
    expect(magmalisks[0].share).toBeCloseTo(.9, 9);
    const stacked = cardTotals(Array.from({ length: 30 }, () => "cindermaw_card")).procs[0];
    expect(stacked.chance).toBe(CARD_CHANCE_CAP);
    expect(stacked.always).toBeUndefined();
    const splash = cardTotals(["tidewyrm_card", "shard_hopper_card"]);
    expect(splash.procs).toEqual([{ effect: "splash", chance: 15, share: .6 }]);
    expect(cardValue(splash, "splash")).toBeGreaterThan(0);
  });

  it("caps chances at 50% and dodge at 30%", () => {
    const many = (cardId: string, times: number) => Array.from({ length: times }, () => cardId);
    expect(cardChance(cardTotals(many("ion_needle_card", 1)), "doubleStrike")).toBe(0);
    expect(cardChance(cardTotals(many("needle_card", 60)), "doubleStrike")).toBe(CARD_CHANCE_CAP);
    expect(cardChance(cardTotals(many("petal_regent_card", 20)), "dodge")).toBe(CARD_DODGE_CAP);
  });

  it("keeps the quickest shield refill and the longest web", () => {
    expect(cardTotals(["glacier_regent_card"]).timing.shield).toBe(8);
    expect(cardTotals(["glacier_regent_card", "aegis_prime_card"]).timing.shield).toBe(6);
    expect(cardTotals(["desert_spider_card"]).timing.web).toBe(2);
    expect(NO_CARDS.timing).toEqual({ shield: 8, web: 2 });
  });
});

describe("guards and slayers", () => {
  it("adds every guard that applies to the attacker, at most 60% off", () => {
    const totals = cardTotals(["glacier_archer_card", "bastion_defender_card", "magma_guard_card"]);
    const ranged = cardDamageTakenMultiplier(totals, { ranged: true });
    expect(ranged).toBeLessThan(1);
    expect(cardDamageTakenMultiplier(totals, { ranged: false })).toBe(1);
    expect(cardDamageTakenMultiplier(totals, { ranged: true, boss: true })).toBeLessThan(ranged);
    expect(cardDamageTakenMultiplier(totals, { mapId: "advanced_lava_wastes" })).toBeLessThan(1);
    const stacked = cardTotals(Array.from({ length: 12 }, () => "ironhorn_card"));
    expect(cardDamageTakenMultiplier(stacked, { boss: true, elite: true })).toBeCloseTo(1 - CARD_GUARD_CAP / 100, 5);
  });

  it("adds every slayer that applies to the target", () => {
    const totals = cardTotals(["dread_warden_card", "nimbus_archer_card", "dune_raider_card"]);
    expect(cardDamageDealtMultiplier(totals, {})).toBe(1);
    expect(cardDamageDealtMultiplier(totals, { elite: true })).toBeCloseTo(1.09, 5);
    expect(cardDamageDealtMultiplier(totals, { elite: true, ranged: true, mapId: "beginner_desert" })).toBeGreaterThan(1.09);
  });
});

describe("card stats", () => {
  it("turns stat cards into multipliers, crit and the caps, and leaves everything at one without cards", () => {
    expect(cardStatFactors(NO_CARDS)).toEqual({ damage: 1, maxHp: 1, armor: 1, regen: 1, critChance: 0, critDamage: 0, attackCapRaise: 0, moveSpeed: 0, range: 0,
      miningSpeed: 0, oreFind: 0, starshardFind: 0, cardHunter: 0, treasure: 0, respawn: 0 });
    const stats = cardStatFactors(cardTotals(["spitter_card", "ember_raider_card", "mossback_card", "brood_card", "striker_card", "dune_striker_card", "dune_needle_card", "tempest_kirin_card", "dune_archer_card"]));
    expect(stats.damage).toBeCloseTo(1.069, 9);
    expect(stats.maxHp).toBeCloseTo(.964, 9);
    expect(stats.armor).toBeCloseTo(1.03, 9);
    expect(stats.regen).toBeCloseTo(1.04, 9);
    expect(stats.critChance).toBeCloseTo(.01, 9);
    expect(stats.critDamage).toBeCloseTo(.06, 9);
    expect(stats.attackCapRaise).toBeCloseTo(.25, 9);
    expect(stats.moveSpeed).toBeCloseTo(.1, 9);
    expect(stats.range).toBe(2);
  });

  it("multiplies power's stats by the active cards, once, whatever is worn, and changes nothing without cards", () => {
    const progress = { maxHp: 200, damage: 50, attackRate: .8, armor: 10, regen: 2, equippedRightHand: "starter_bow", equippedChest: "wooden_armor" };
    const plain = effectivePlayerPowerStats(progress, null, () => ({ tier: 1 }));
    expect(effectivePlayerPowerStats({ ...progress, activeCards: [] }, null, () => ({ tier: 1 }))).toEqual(plain);
    const carded = effectivePlayerPowerStats({ ...progress, activeCards: ["ember_raider_card", "mossback_card"] }, null, () => ({ tier: 1 }));
    expect(effectivePlayerPowerStats(progress, null, () => ({ tier: 1 }), cardTotals(["ember_raider_card", "mossback_card"]))).toEqual(carded);
    expect(carded.damage).toBeCloseTo(plain.damage * 1.049, 9);
    expect(carded.maxHp).toBeCloseTo(plain.maxHp * .964, 9);
    expect(carded.armor).toBeCloseTo(plain.armor * 1.03, 9);
    expect(carded.regen).toBeCloseTo(plain.regen, 9);
  });

  it("multiplies critical damage, and raises its cap by the same factor", () => {
    const plain = criticalDamage({ rating: 40 });
    const carded = criticalDamage({ rating: 40, card: .15 });
    expect(carded.multiplier).toBeCloseTo(plain.multiplier * 1.15, 9);
    expect(carded.fromCards).toBeCloseTo(plain.multiplier * .15, 9);
    expect(criticalDamage({ rating: 1e9, card: 10 }).cap).toBeCloseTo(criticalDamage({ rating: 1e9 }).cap * 11, 9);
  });
});

describe("cards outside a fight", () => {
  it("adds Bounty cards to their own stat's gain and to all stats'", () => {
    const totals = cardTotals(["seed_spitter_card", "aurora_oracle_card"]);
    expect(cardStatGainFactor(totals, "health")).toBeCloseTo(1.053, 9);
    expect(cardStatGainFactor(totals, "damage")).toBeCloseTo(1.017, 9);
    expect(cardStatGainFactor(NO_CARDS, "health")).toBe(1);
    const next = applyEnemyRewards({ damage: 10, maxHp: 100, attackRate: 1, armor: 0, regen: 0 },
      [{ type: "health", amount: 10, count: 2 }, { type: "damage", amount: 1, count: 1 }], type => 2 * cardStatGainFactor(totals, type));
    expect(next.maxHp).toBeCloseTo(100 + 40 * 1.053, 9);
    expect(next.damage).toBeCloseTo(10 + 2 * 1.017, 9);
  });

  it("shows an active Bounty card's share in a reward's popup", () => {
    const equipment = { weapon: "", head: "forest_cap", chest: "", weaponLevel: 0, headLevel: 0, chestLevel: 0, activeCards: ["seed_spitter_card"] };
    const plain = effectiveRewardAmount("health", 10, 1, {}, { ...equipment, activeCards: [] });
    expect(effectiveRewardAmount("health", 10, 1, {}, equipment)).toBeCloseTo(plain * 1.036, 9);
    expect(effectiveRewardAmount("speed", 10, 1, {}, equipment)).toBe(10);
  });

  it("speeds respawns and mining, raises Starshard odds and finds an extra ore", () => {
    expect(respawnSecondsWithCards(10, .03)).toBeCloseTo(10 / 1.03, 9);
    expect(respawnSecondsWithCards(10, 0)).toBe(10);
    const rock = MINING_NODES.find(node => node.kind === "mysterious")!;
    expect(miningBreakSeconds(rock, 0, .07)).toBeCloseTo(miningBreakSeconds(rock, 0) / 1.07, 9);
    expect(miningYield(rock, .1).starshard).toBe(MINING_STARSHARD_CHANCE);
    expect(miningYield(rock, .1, { starshardFind: .24 }).starshard).toBe(2);
    expect(miningYield(rock, .3, { starshardFind: .24 }).starshard).toBe(1);
    const plain = miningYield(rock, .99)[rock.ore]!;
    expect(miningYield(rock, .99, { oreFind: .07 }, .05)[rock.ore]).toBe(plain + 1);
    expect(miningYield(rock, .99, { oreFind: .07 }, .5)[rock.ore]).toBe(plain);
  });
});
