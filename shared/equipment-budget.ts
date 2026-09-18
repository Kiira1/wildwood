/** Fixed item budgets, authored for their source map; never based on a player's stats.
 * Forest gear gives an early +25 damage / +125 health / +3.75 regen jump. Starting at Desert,
 * each map triples its flat amounts to follow the campaign's existing scale.
 * The reference budget is 100% of Desert entry damage/regen and 50% health for chest armor. It does not increase as the wearer farms or researches.
 */
export function flatEquipmentBudget(tier: number) {
  if (!Number.isInteger(tier) || tier < 1 || tier > 15) throw new RangeError("Equipment tier must be 1–15");
  if (tier === 1) return { damage: 25, health: 125, regen: 3.75 };
  const scale = 3 ** (tier - 2);
  return { damage: 2400 * scale, health: 2000 * scale, regen: 60 * scale };
}
