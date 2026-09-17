/** Fixed item budgets, authored for their source map; never based on a player's stats.
 * Forest gear gives an early +5 damage / +25 health jump. Starting at Desert,
 * each map triples its flat amounts to follow the campaign's existing scale.
 * The reference budget is 20% of Desert entry damage/regen and 10% health per
 * defensive slot. It does not increase as the wearer farms or researches.
 */
export function flatEquipmentBudget(tier: number) {
  if (!Number.isInteger(tier) || tier < 1 || tier > 15) throw new RangeError("Equipment tier must be 1–15");
  if (tier === 1) return { damage: 5, health: 25, regen: 0 };
  const scale = 3 ** (tier - 2);
  return { damage: 480 * scale, health: 400 * scale, regen: 12 * scale };
}
