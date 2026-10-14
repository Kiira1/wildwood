import { expect, it } from "vitest";
import { advanceDuelCombat, initialDuelCombatState, DUEL_COMBAT_VERSION, type DuelCombat } from "./duel-combat";
import { damageAfterArmor } from "./combat";

const fighters = (over: Partial<DuelCombat> = {}): DuelCombat => ({
  combatVersion: DUEL_COMBAT_VERSION, riposteSeed: 77,
  challengerMaxHp: 1e6, challengerDamage: 100, challengerArmor: 0, challengerRegen: 0, challengerAttackRate: 1,
  opponentMaxHp: 1e6, opponentDamage: 100, opponentArmor: 0, opponentRegen: 0, opponentAttackRate: 1,
  ...over,
});
const run = (duel: DuelCombat, to = 2_000_000) => advanceDuelCombat(duel, initialDuelCombatState(duel), 0, to);

it("adds three spin strikes and one shockwave, through armor", () => {
  const duel = fighters({ challengerWhirlwind: 100, challengerShockwave: 100, opponentArmor: 200 });
  expect(run(duel, 1_000_000).challengerDamageDealt).toBeCloseTo(damageAfterArmor(100, 200)
    + 3 * damageAfterArmor(45, 200) + damageAfterArmor(80, 200));
  expect(run({ ...duel, combatVersion: 7 })).toEqual(run(fighters({ combatVersion: 7, opponentArmor: 200 })));
});

it("deflects a ranged hit without taking it, caps the return, and never reflects it twice", () => {
  const duel = fighters({ challengerWeaponItem: "ion_bow", opponentWeaponItem: "ion_sword", opponentDeflect: 100,
    challengerDamage: 10_000, opponentDamage: 0, opponentAttackRate: 100, challengerArmor: 200, challengerRiposte: 1, opponentMaxHp: 100 });
  const result = run(duel, 1_000_000);
  expect(result.challengerDamageDealt).toBe(0);
  expect(result.opponentHp).toBe(100);
  expect(result.opponentDamageDealt).toBeCloseTo(damageAfterArmor(100, 200));
  const melee = run({ ...duel, challengerWeaponItem: "ion_sword" }, 3_000_000);
  expect(melee.challengerDamageDealt).toBeGreaterThan(0);
});

it("resolves sword rolls identically in one step and a series of replay frames", () => {
  const duel = fighters({ challengerWhirlwind: 15, challengerShockwave: 11, opponentDeflect: 12,
    challengerWeaponItem: "ion_sword", opponentWeaponItem: "ion_bow" });
  let state = initialDuelCombatState(duel), from = 0;
  for (const to of [500_000, 1_900_000, 5_000_000, 12_000_000, 30_000_000]) {
    const { resolvedMicros, ...next } = advanceDuelCombat(duel, state, from, to);
    state = next; from = resolvedMicros;
  }
  expect({ ...state, resolvedMicros: from }).toEqual(run(duel, 30_000_000));
});
