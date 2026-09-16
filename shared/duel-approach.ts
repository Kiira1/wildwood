import { itemDefinition } from "./items";

export type DuelWeapons = {
  combatVersion?: number;
  challengerWeaponItem?: string; opponentWeaponItem?: string;
  challengerRightHandItem?: string; challengerLeftHandItem?: string;
  opponentRightHandItem?: string; opponentLeftHandItem?: string;
};
export const DUEL_START_DISTANCE = 240;
export const DUEL_APPROACH_SPEED = 90;

/** Actual weapon is frozen separately from cosmetics. Old records can only
 * infer from visible equipment; an empty cosmetic used the ranged fallback. */
export function duelWeapon(duel: DuelWeapons, challenger: boolean) {
  return (challenger ? duel.challengerWeaponItem : duel.opponentWeaponItem)
    || (challenger ? duel.challengerRightHandItem || duel.challengerLeftHandItem : duel.opponentRightHandItem || duel.opponentLeftHandItem)
    || "starter_bow";
}

/** Frozen equipment drives the same approach on server, live view, and replay.
 * Historical duels keep their original stationary combat and attack times. */
export function duelApproach(duel: DuelWeapons) {
  const reach = (item: string | undefined) => {
    const weapon = itemDefinition(item)?.weapon;
    return (duel.combatVersion ?? 0) >= 2 && weapon?.mode === "MELEE" ? weapon.range ?? 75 : null;
  };
  const challenger = reach(duelWeapon(duel, true));
  const opponent = reach(duelWeapon(duel, false));
  const speed = (Number(challenger !== null) + Number(opponent !== null)) * DUEL_APPROACH_SPEED;
  const stopAt = speed ? Math.max(0, DUEL_START_DISTANCE - Math.min(challenger ?? Infinity, opponent ?? Infinity)) / speed : 0;
  return { challenger, opponent, speed, stopAt };
}

export function duelPositionsAt(duel: DuelWeapons, seconds: number) {
  const plan = duelApproach(duel);
  const traveled = Math.min(plan.stopAt, Math.max(0, seconds)) * DUEL_APPROACH_SPEED;
  const moving = seconds > 0 && seconds < plan.stopAt;
  return {
    challengerX: -DUEL_START_DISTANCE / 2 + (plan.challenger !== null ? traveled : 0),
    opponentX: DUEL_START_DISTANCE / 2 - (plan.opponent !== null ? traveled : 0),
    challengerMoving: moving && plan.challenger !== null,
    opponentMoving: moving && plan.opponent !== null,
  };
}

/** Delay only the first melee hit; subsequent hits keep the earned attack rate.
 * Leave enough time for the normal sword windup after reaching melee distance. */
export function duelAttackDelays(duel: DuelWeapons & { challengerAttackRate: number; opponentAttackRate: number }) {
  const plan = duelApproach(duel);
  const delay = (range: number | null, rate: number) => {
    if (range === null || !plan.speed) return 0;
    const arrival = Math.max(0, DUEL_START_DISTANCE - range) / plan.speed;
    const interval = Math.max(.000001, Math.round(rate * 1_000_000) / 1_000_000);
    const windup = Math.min(.42, interval) * .12 / .42;
    return Math.max(0, Math.ceil((arrival + windup) * 1_000_000) - Math.round(interval * 1_000_000)) / 1_000_000;
  };
  return { challenger: delay(plan.challenger, duel.challengerAttackRate), opponent: delay(plan.opponent, duel.opponentAttackRate) };
}
