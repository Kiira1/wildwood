import { BLACK_BOOTS, BLACK_BOOTS_COMBAT_DELAY_MS, BLACK_BOOTS_SPEED_BONUS } from "../../../shared/items";

/** Keep this clock across map transitions and equipment swaps. */
export function createOutOfCombatSpeed(now: () => number = () => performance.now()) {
  let lastCombatAt = Number.NEGATIVE_INFINITY;
  return {
    markCombat() { lastCombatAt = now(); },
    bonus(feet: string, dueling = false) {
      if (dueling) lastCombatAt = now();
      return feet === BLACK_BOOTS && !dueling && now() - lastCombatAt >= BLACK_BOOTS_COMBAT_DELAY_MS
        ? BLACK_BOOTS_SPEED_BONUS : 0;
    },
  };
}
