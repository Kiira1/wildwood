import type { WeaponSchool } from "./weapon-mastery";

/**
 * Long-term gear: a few grades that last days, bought from the Smith with gold or crafted, instead of a new piece
 * every map. A school's Mastery level opens a grade for buying and crafting; gear already owned is never locked.
 */
export const GEAR_GRADES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"] as const;
export type GearGrade = typeof GEAR_GRADES[number];

export const GEAR_GRADE_NAMES: Readonly<Record<GearGrade, string>> = {
  common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic",
};

/** The grade's base bonus in percent: damage on a weapon, regen on a helmet, max health on armor. */
export const GRADE_BONUS_PERCENT: Readonly<Record<GearGrade, number>> = {
  common: 6, uncommon: 15, rare: 30, epic: 50, legendary: 80, mythic: 120,
};

/** The Mastery level that opens a grade for buying and crafting. */
export const GRADE_MASTERY_LEVEL: Readonly<Record<GearGrade, number>> = {
  common: 0, uncommon: 5, rare: 10, epic: 20, legendary: 30, mythic: 40,
};

/** The Smith's price in gold. Gold drops at about 180 an hour of active play. */
export const GRADE_GOLD_PRICE: Readonly<Record<GearGrade, number>> = {
  common: 100, uncommon: 1_000, rare: 5_000, epic: 20_000, legendary: 60_000, mythic: 150_000,
};

/** The old map tier a grade stands in for where tiers still decide things (weapon skill rolls, refine grade). */
export const GRADE_ITEM_TIER: Readonly<Record<GearGrade, number>> = {
  common: 1, uncommon: 4, rare: 7, epic: 10, legendary: 13, mythic: 15,
};

export const ARMOR_CLASSES = ["light", "medium", "heavy", "magic"] as const;
export type ArmorClass = typeof ARMOR_CLASSES[number];

export const ARMOR_CLASS_NAMES: Readonly<Record<ArmorClass, string>> = { light: "Light", medium: "Medium", heavy: "Heavy", magic: "Magic" };

/**
 * What each class trades: the share of the grade's bonus it gives, and its perk per piece worn (Medium has none). Heavy
 * belongs to no school: it opens at the wearer's best school and pays for its strength in speed.
 */
export const ARMOR_CLASS_DETAILS: Readonly<Record<ArmorClass, {
  school: WeaponSchool | null; bonusShare: number; moveSpeedPercent: number; skillChancePercent: number; perk: string;
}>> = {
  light: { school: "archery", bonusShare: .8, moveSpeedPercent: 3, skillChancePercent: 0, perk: "+3% Move Speed" },
  medium: { school: "swordplay", bonusShare: 1, moveSpeedPercent: 0, skillChancePercent: 0, perk: "" },
  heavy: { school: null, bonusShare: 1.3, moveSpeedPercent: -4, skillChancePercent: 0, perk: "-4% Move Speed" },
  magic: { school: "sorcery", bonusShare: .8, moveSpeedPercent: 0, skillChancePercent: 3, perk: "+3% Skill Chance" },
};

/** Helmet and armor both of the class that matches the weapon's school: this much more damage. */
export const CLASS_SET_DAMAGE_PERCENT = 5;

export const gradeIndex = (grade: GearGrade) => GEAR_GRADES.indexOf(grade);
export const isGearGrade = (value: unknown): value is GearGrade => (GEAR_GRADES as readonly unknown[]).includes(value);
export const isArmorClass = (value: unknown): value is ArmorClass => (ARMOR_CLASSES as readonly unknown[]).includes(value);

/** The bonus percent of a helmet or armor piece of `grade` and `armorClass`. */
export const armorBonusPercent = (grade: GearGrade, armorClass: ArmorClass) =>
  GRADE_BONUS_PERCENT[grade] * ARMOR_CLASS_DETAILS[armorClass].bonusShare;

/** The Mastery a class's grade is opened by: its school's level, or the best school's for Heavy. */
export function armorClassMasteryLevel(armorClass: ArmorClass, levels: Readonly<Partial<Record<WeaponSchool, number>>>) {
  const school = ARMOR_CLASS_DETAILS[armorClass].school;
  return school ? levels[school] ?? 0 : Math.max(0, ...Object.values(levels).map(level => level ?? 0));
}

/** The highest grade a Mastery level opens. */
export function highestGradeFor(level: number): GearGrade {
  let best: GearGrade = "common";
  for (const grade of GEAR_GRADES) if (level >= GRADE_MASTERY_LEVEL[grade]) best = grade;
  return best;
}

/**
 * The grade an old map-tier piece converts to: the one whose bonus is nearest the piece's own (`bonusPercent`, before
 * slot tiers and refines), ties going up, so a converted piece is about as strong as it was.
 */
export function gradeForOldBonus(bonusPercent: number) {
  let best: GearGrade = "common", gap = Infinity;
  for (const grade of GEAR_GRADES) {
    const distance = Math.abs(GRADE_BONUS_PERCENT[grade] - bonusPercent);
    if (distance <= gap) { best = grade; gap = distance; }
  }
  return best;
}

/** What the Smith pays for an old map-tier piece left in the bag when gear moves to grades. */
export const oldTierSalePrice = (tier: number) => Math.max(1, Math.round(10 * Math.max(1, tier) ** 2));
