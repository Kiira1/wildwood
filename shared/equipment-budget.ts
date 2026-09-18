/** All stat-bearing equipment scales earned stats by a modest percentage.
 * Tier steps are independent of campaign combat/reward tuning. +10 adds 80%
 * of the original bonus, so the strongest item grows from 40% to 72%. */
export function equipmentStatDefinition(tier: number, slot: "HAND" | "HEAD" | "CHEST", quality = 1) {
  if (!Number.isInteger(tier) || tier < 1 || tier > 15) throw new RangeError("Equipment tier must be 1–15");
  if (!Number.isFinite(quality) || quality <= 0 || quality > 1) throw new RangeError("Equipment quality must be >0 and <=1");
  // Quality preserves the regular Snow/Night bows below their rarer alternatives.
  const percent = Math.round((5 + (tier - 1) * 2.5) * quality * 100) / 100;
  if (slot === "HAND") return { stats: [`DAMAGE +${percent}%`], weapon: { mode: "RANGED" as const, projectile: "ARROW" as const, damageMultiplierBonus: percent / 100 } };
  if (slot === "HEAD") return { stats: [`REGEN +${percent}%`], modifiers: { regenerationMultiplierBonus: percent / 100 } };
  return { stats: [`MAX HEALTH +${percent}%`], modifiers: { maxHealthMultiplierBonus: percent / 100 } };
}
