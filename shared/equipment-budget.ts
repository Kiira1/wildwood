import { referenceBuildForMap } from "./progression";

export const EQUIPMENT_ENTRY_STAT_SHARE = .2;
// Forest is the short onboarding map; this is its fixed early-farming reference,
// not the player's starting save. Later tiers use the encounter authoring curve.
export const FOREST_EQUIPMENT_REFERENCE = { damage: 25, maxHp: 125, regen: 3.75 };

/** Fixed armor map-entry bonuses. +10 adds 80%, so even maxed gear supplies at most
 * 36% of the map's reference stat. Never scales with the wearer's earned stats. */
export function flatEquipmentBudget(tier: number) {
  if (!Number.isInteger(tier) || tier < 1 || tier > 15) throw new RangeError("Equipment tier must be 1–15");
  const reference = tier === 1 ? FOREST_EQUIPMENT_REFERENCE : referenceBuildForMap(tier - 2);
  return { damage: reference.damage * EQUIPMENT_ENTRY_STAT_SHARE,
    health: reference.maxHp * EQUIPMENT_ENTRY_STAT_SHARE,
    regen: reference.regen * EQUIPMENT_ENTRY_STAT_SHARE };
}

/** Shared by original and extended catalogs, including inspection descriptions. */
export function equipmentStatDefinition(tier: number, slot: "HAND" | "HEAD" | "CHEST", quality = 1) {
  if (!Number.isFinite(quality) || quality <= 0 || quality > 1) throw new RangeError("Equipment quality must be >0 and <=1");
  const budget = flatEquipmentBudget(tier);
  const amount = Math.round((slot === "HAND" ? budget.damage : slot === "HEAD" ? budget.regen : budget.health) * quality * 100) / 100;
  if (slot === "HAND") {
    // Modest tier steps keep weapons useful as earned damage grows. Quality
    // preserves the regular Snow/Night bows below their rarer alternatives.
    const percent = Math.round((5 + (tier - 1) * 2.5) * quality * 100) / 100;
    return { stats: [`DAMAGE +${percent}%`], weapon: { mode: "RANGED" as const, projectile: "ARROW" as const, damageMultiplierBonus: percent / 100 } };
  }
  if (slot === "HEAD") return { stats: [`REGEN +${amount}`], modifiers: { regenerationBonus: amount } };
  return { stats: [`MAX HEALTH +${amount}`], modifiers: { maxHealthBonus: amount } };
}
