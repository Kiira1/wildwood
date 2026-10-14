import { describe, expect, it } from "vitest";
import { advanceDuelCombat, initialDuelCombatState, DUEL_COMBAT_VERSION, type DuelCombat } from "./duel-combat";
import { duelAttackDelays } from "./duel-approach";
import { regularEnemySeededUnit } from "./regular-enemy-simulation";
import { damageAfterArmor } from "./combat";

const fighters = (over: Partial<DuelCombat> = {}): DuelCombat => ({
  combatVersion: DUEL_COMBAT_VERSION, riposteSeed: 77,
  challengerMaxHp: 1000, challengerDamage: 100, challengerArmor: 0, challengerRegen: 0, challengerAttackRate: 1,
  opponentMaxHp: 1000, opponentDamage: 0, opponentArmor: 0, opponentRegen: 0, opponentAttackRate: 1,
  ...over,
});
const run = (duel: DuelCombat, seconds: number) => advanceDuelCombat(duel, initialDuelCombatState(duel), 0, seconds * 1_000_000);
/** When the challenger's first attack lands, the approach included. */
const firstHitAt = (duel: DuelCombat) => duelAttackDelays(duel).challenger + duel.challengerAttackRate;
/** A riposte seed whose roll for this side, attack and card key lands under `chance`. */
const seedFor = (side: "challenger" | "opponent", attack: number, key: string, chance: number) =>
  [...Array(5000).keys()].find(seed => regularEnemySeededUnit("duel-card", String(seed), side, attack, key) < chance)!;

describe("cards in duels", () => {
  it("plays a fight with no cards worn exactly as version 8 did", () => {
    const duel = fighters({ opponentDamage: 60, challengerArmor: 40, challengerRiposte: .3, challengerCards: [], opponentCards: [] });
    expect(run(duel, 20)).toEqual(run({ ...duel, combatVersion: 8 }, 20));
  });

  it("lands Iaido's first hit at its factor, and the opener on a defender at full health", () => {
    const at = firstHitAt(fighters());
    expect(run(fighters({ challengerCards: ["koi_shogun_card"], challengerFirstHit: 3 }), at).challengerDamageDealt).toBeCloseTo(300, 6);
    expect(run(fighters({ challengerCards: ["cinder_striker_card"] }), at).challengerDamageDealt).toBeCloseTo(110, 6);
  });

  it("guards against the attacker's kind of weapon, and a shield soaks the first hit", () => {
    const at = firstHitAt(fighters({ challengerWeaponItem: "ion_bow" }));
    const guarded = run(fighters({ challengerWeaponItem: "ion_bow", opponentCards: ["glacier_archer_card"] }), at);
    expect(guarded.challengerDamageDealt).toBeCloseTo(94, 6);
    expect(guarded.opponentBlocked).toBeCloseTo(6, 6);
    const shielded = run(fighters({ opponentCards: ["glacier_regent_card"] }), firstHitAt(fighters()));
    expect(shielded.challengerDamageDealt).toBeCloseTo(50, 6);
  });

  it("burns over time without stacking, and the burn can end the fight", () => {
    const duel = fighters({ challengerCards: ["magmalisk_card"] });
    const start = firstHitAt(duel);
    const plain = run(fighters(), start + 3.5).challengerDamageDealt;
    // Every hit burns 30% over 3s: 10 a second from the first hit on, refreshed by each one after.
    expect(run(duel, start + 3.5).challengerDamageDealt).toBeCloseTo(plain + 35, 6);
    const finished = run(fighters({ challengerCards: ["magmalisk_card"], opponentMaxHp: 105 }), start + 1);
    expect(finished.opponentHp).toBe(0);
  });

  it("heals the attacker by lifesteal, and Last Stand catches one killing blow", () => {
    const thirsty = fighters({ challengerCards: ["abyss_archer_card"], opponentDamage: 100, opponentAttackRate: .5 });
    const healed = run(thirsty, firstHitAt(thirsty));
    expect(healed.challengerHp).toBeCloseTo(1000 - 100 * healed.opponentAttacks + 100 * .0064, 6);
    const stand = fighters({ challengerDamage: 5000, opponentCards: ["gloomroot_card"] });
    const first = run(stand, firstHitAt(stand));
    expect(first.opponentHp).toBeCloseTo(500, 6);
    expect(run(stand, firstHitAt(stand) + 1).opponentHp).toBe(0);
  });

  it("stuns the defender's next attacks and dodges on a seeded roll", () => {
    const seed = seedFor("challenger", 1, "proc:0", .12);
    const stun = fighters({ riposteSeed: seed, challengerCards: ["frostclaw_card"], opponentDamage: 100, opponentAttackRate: .5,
      challengerAttackRate: .4 });
    const plain = run({ ...stun, challengerCards: [] }, 2);
    expect(run(stun, 2).opponentDamageDealt).toBeLessThan(plain.opponentDamageDealt);
    const dodgeSeed = seedFor("opponent", 1, "dodge", .021);
    const dodge = run(fighters({ riposteSeed: dodgeSeed, opponentCards: ["petal_regent_card"] }), firstHitAt(fighters()));
    expect(dodge.challengerDamageDealt).toBe(0);
    expect(dodge.opponentBlocked).toBeCloseTo(damageAfterArmor(100, 0), 6);
  });

  it("resolves a card fight the same in one step as in many frames, as the server and a replay do", () => {
    const duel = fighters({ challengerCards: ["magmalisk_card", "abyss_archer_card", "frostclaw_card"], opponentCards: ["glacier_regent_card", "venom_guard_card"],
      opponentDamage: 80, opponentAttackRate: .8, riposteSeed: 12345 });
    let state = initialDuelCombatState(duel), from = 0;
    for (const to of [700_000, 1_900_000, 4_200_000, 9_000_000, 20_000_000]) {
      const { resolvedMicros, ...next } = advanceDuelCombat(duel, state, from, to);
      state = next; from = resolvedMicros;
    }
    const whole = run(duel, 20);
    expect(state.challengerHp).toBeCloseTo(whole.challengerHp, 9);
    expect(state.opponentHp).toBeCloseTo(whole.opponentHp, 9);
    expect(state.challengerDamageDealt).toBeCloseTo(whole.challengerDamageDealt, 9);
  });
});
