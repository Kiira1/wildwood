/** All personal bosses recover 0.1% of maximum HP per active simulation second. */
export const BOSS_REGEN_FRACTION_PER_SECOND = .001;

/** Discrete hits, with healing between attacks. Infinity means DPS cannot overcome regen. */
export function bossHitsToDefeat(maxHp: number, hitDamage: number, attackInterval: number, regenFraction = BOSS_REGEN_FRACTION_PER_SECOND) {
  if (hitDamage >= maxHp) return 1;
  const netDamage = hitDamage - maxHp * regenFraction * attackInterval;
  return netDamage > 0 ? 1 + Math.ceil((maxHp - hitDamage) / netDamage) : Infinity;
}
