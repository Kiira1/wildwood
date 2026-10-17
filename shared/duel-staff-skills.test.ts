import { expect, it } from "vitest";
import { advanceDuelCombat, initialDuelCombatState, DUEL_COMBAT_VERSION, type DuelCombat } from "./duel-combat";
import { damageAfterArmor } from "./combat";
import { CHAIN_DAMAGE_SHARE, FROST_NOVA_SECONDS, FROST_NOVA_SLOW, METEOR_DAMAGE_SHARE } from "./staff-skills";

const fighters = (over: Partial<DuelCombat> = {}): DuelCombat => ({
  combatVersion: DUEL_COMBAT_VERSION, riposteSeed: 77,
  challengerMaxHp: 1e6, challengerDamage: 100, challengerArmor: 0, challengerRegen: 0, challengerAttackRate: 1,
  opponentMaxHp: 1e6, opponentDamage: 100, opponentArmor: 0, opponentRegen: 0, opponentAttackRate: 1,
  challengerWeaponItem: "ion_staff", opponentWeaponItem: "ion_bow",
  ...over,
});
const run = (duel: DuelCombat, to = 2_000_000) => advanceDuelCombat(duel, initialDuelCombatState(duel), 0, to);

it("adds a meteor and a chain's jump back off the one opponent, through armor", () => {
  const duel = fighters({ challengerMeteor: 100, challengerChain: 100, opponentArmor: 200 });
  expect(run(duel, 1_000_000).challengerDamageDealt).toBeCloseTo(damageAfterArmor(100, 200)
    + damageAfterArmor(100 * METEOR_DAMAGE_SHARE, 200) + damageAfterArmor(100 * CHAIN_DAMAGE_SHARE, 200));
  // Fights from before staff skills never roll them.
  expect(run({ ...duel, combatVersion: 9 })).toEqual(run(fighters({ combatVersion: 9, opponentArmor: 200 })));
});

it("chills the opponent with a Frost Nova: their hits land softer until it runs out", () => {
  // Both sides hit each second and the challenger's resolves first, so its chill softens the hit beside it too.
  expect(run(fighters(), 2_000_000).opponentDamageDealt).toBeCloseTo(200);
  expect(run(fighters({ challengerFrostNova: 100 }), 2_000_000).opponentDamageDealt).toBeCloseTo(2 * 100 * (1 - FROST_NOVA_SLOW));
  // Once the last chill has run out, hits are whole again.
  const once = fighters({ challengerFrostNova: 100, challengerAttackRate: 5 });
  const atNova = run(once, 5_000_000).opponentDamageDealt;
  expect(run(once, Math.round((5 + FROST_NOVA_SECONDS + 1) * 1_000_000)).opponentDamageDealt - atNova)
    .toBeCloseTo(100 * (1 - FROST_NOVA_SLOW) * 2 + 100 * 1);
});

it("resolves staff rolls identically in one step and a series of replay frames", () => {
  const duel = fighters({ challengerMeteor: 15, challengerChain: 11, challengerFrostNova: 12, opponentRiposte: .2 });
  let state = initialDuelCombatState(duel), from = 0;
  for (const to of [500_000, 1_900_000, 5_000_000, 12_000_000, 30_000_000]) {
    const { resolvedMicros, ...next } = advanceDuelCombat(duel, state, from, to);
    state = next; from = resolvedMicros;
  }
  expect({ ...state, resolvedMicros: from }).toEqual(run(duel, 30_000_000));
  expect(run(duel, 30_000_000)).toEqual(run(duel, 30_000_000));
});
