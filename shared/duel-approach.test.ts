import { expect, it } from "vitest";
import { duelAttackDelays, duelPositionsAt } from "./duel-approach";
import { advanceDuelCombat, initialDuelCombatState, type DuelCombat } from "./duel-combat";
const fight: DuelCombat = { combatVersion: 2, challengerRightHandItem: "wooden_sword", opponentRightHandItem: "starter_bow",
  challengerMaxHp: 10000, opponentMaxHp: 10000, challengerDamage: 10, opponentDamage: 10,
  challengerArmor: 0, opponentArmor: 0, challengerRegen: 0, opponentRegen: 0, challengerAttackRate: .1, opponentAttackRate: .1 };
it("walks only the sword user toward the archer and stops at weapon reach", () => {
  expect(duelPositionsAt(fight, 0)).toMatchObject({ challengerX: -120, opponentX: 120, challengerMoving: false });
  expect(duelPositionsAt(fight, 1)).toEqual({ challengerX: -30, opponentX: 120, challengerMoving: true, opponentMoving: false });
  expect(duelPositionsAt(fight, 10)).toEqual({ challengerX: 45, opponentX: 120, challengerMoving: false, opponentMoving: false });
  const reversed = { ...fight, challengerRightHandItem: "starter_bow", opponentRightHandItem: "wooden_sword" };
  expect(duelPositionsAt(reversed, 1)).toMatchObject({ challengerX: -120, opponentX: 30, challengerMoving: false, opponentMoving: true });
});
it("brings two swords toward the middle without overlapping", () => {
  const swords = { ...fight, opponentRightHandItem: "wooden_sword" };
  expect(duelPositionsAt(swords, .5)).toMatchObject({ challengerX: -75, opponentX: 75, challengerMoving: true, opponentMoving: true });
  expect(duelPositionsAt(swords, 2)).toMatchObject({ challengerX: -37.5, opponentX: 37.5, challengerMoving: false, opponentMoving: false });
});
it("lets the bow attack during approach but blocks even fast sword hits until contact", () => {
  const before = advanceDuelCombat(fight, initialDuelCombatState(fight), 0, 1_800_000);
  expect(before.challengerAttacks).toBe(0); expect(before.opponentAttacks).toBe(18);
  const firstHit = Math.round((duelAttackDelays(fight).challenger + fight.challengerAttackRate) * 1_000_000);
  const almost = advanceDuelCombat(fight, initialDuelCombatState(fight), 0, firstHit - 1);
  const contact = advanceDuelCombat(fight, almost, firstHit - 1, firstHit);
  expect(almost.challengerAttacks).toBe(0); expect(contact.challengerAttacks).toBe(1);
  const position = duelPositionsAt(fight, firstHit / 1_000_000);
  expect(position.opponentX - position.challengerX).toBe(75);
});
it("matches delayed server pulses to replay with approach and regeneration", () => {
  const battle = { ...fight, challengerRegen: 2, opponentRegen: 3, challengerAttackRate: .3733333 };
  let state = initialDuelCombatState(battle), from = 0;
  for (const to of [200000, 1234567, 1833333, 2300000, 7800000]) {
    const next = advanceDuelCombat(battle, state, from, to); state = next; from = next.resolvedMicros;
  }
  const whole = advanceDuelCombat(battle, initialDuelCombatState(battle), 0, 7800000);
  expect(state.challengerHp).toBeCloseTo(whole.challengerHp, 8);
  expect(state.opponentHp).toBeCloseTo(whole.opponentHp, 8);
  expect(state.challengerAttacks).toBe(whole.challengerAttacks);
});
it("keeps bows and saved stationary sword duels on their original schedule", () => {
  const old = { ...fight, combatVersion: 1 };
  expect(duelAttackDelays(old)).toEqual({ challenger: 0, opponent: 0 });
  expect(duelPositionsAt(old, 5)).toMatchObject({ challengerX: -120, opponentX: 120 });
  expect(duelAttackDelays({ ...fight, challengerRightHandItem: "starter_bow" })).toEqual({ challenger: 0, opponent: 0 });
});
it("a sword killed on approach never lands a remote hit", () => {
  const lethal = { ...fight, opponentDamage: 100000 };
  const state = advanceDuelCombat(lethal, initialDuelCombatState(lethal), 0, 30000000);
  expect(state.challengerHp).toBe(0); expect(state.challengerAttacks).toBe(0);
  expect(state.resolvedMicros).toBe(100000);
});
