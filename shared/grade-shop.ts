import {
  ARMOR_CLASSES, ARMOR_CLASS_DETAILS, GEAR_GRADES, GRADE_GOLD_PRICE, GRADE_MASTERY_LEVEL, armorClassMasteryLevel, gradeIndex,
  type ArmorClass, type GearGrade,
} from "./gear-grades";
import {
  GRADE_ARMOR_KINDS, GRADE_WEAPON_KINDS, armorClassOf, gradeEquipmentKindOf, gradeItemId, gradeOf, isGradeItemId,
  type GradeArmorKind, type GradeItemId, type GradeWeaponKind,
} from "./grade-equipment";
import { WEAPON_SCHOOL_NAMES, masteryLevel, type WeaponSchool } from "./weapon-mastery";

/**
 * The Smith's gear for gold (buy_grade_gear): a piece can be bought once its grade is open and it is not already
 * held. Shared so the window and the server judge a buy the same way.
 */
export type MasteryLevels = Readonly<Partial<Record<WeaponSchool, number>>>;

const WEAPON_SCHOOL: Readonly<Record<GradeWeaponKind, WeaponSchool>> = { bow: "archery", sword: "swordplay", staff: "sorcery" };

/** One line of the shop: a weapon, or a class's helmet or armor. */
export type GradeShopLine = { kind: GradeWeaponKind } | { kind: GradeArmorKind; armorClass: ArmorClass };

export const GRADE_SHOP_LINES: readonly GradeShopLine[] = [
  ...GRADE_WEAPON_KINDS.map(kind => ({ kind })),
  ...ARMOR_CLASSES.flatMap(armorClass => GRADE_ARMOR_KINDS.map(kind => ({ kind, armorClass }))),
];

export const gradeShopItemId = (line: GradeShopLine, grade: GearGrade): GradeItemId =>
  "armorClass" in line ? gradeItemId(line.kind, grade, line.armorClass) : gradeItemId(line.kind, grade);

/** Each school's level from its points. */
export const masteryLevels = (points: Readonly<Partial<Record<WeaponSchool, number | bigint>>>): MasteryLevels =>
  Object.fromEntries(Object.entries(points).map(([school, value]) => [school, masteryLevel(value ?? 0)]));

/** The school whose level opens a piece's grade; null for Heavy, which any school opens. */
export function gradeShopSchool(itemId: GradeItemId): WeaponSchool | null {
  const armorClass = armorClassOf(itemId);
  return armorClass ? ARMOR_CLASS_DETAILS[armorClass].school : WEAPON_SCHOOL[gradeEquipmentKindOf(itemId) as GradeWeaponKind];
}

/** The Mastery level that counts for a piece: its school's, or the best school's for Heavy. */
export function gradeShopLevel(itemId: GradeItemId, levels: MasteryLevels) {
  const armorClass = armorClassOf(itemId);
  return armorClass ? armorClassMasteryLevel(armorClass, levels) : levels[gradeShopSchool(itemId)!] ?? 0;
}

/** The level a piece needs: "Lv 10 Archery", or "Lv 10 In Any School" for Heavy. */
export function gradeShopNeed(itemId: GradeItemId) {
  const school = gradeShopSchool(itemId), level = GRADE_MASTERY_LEVEL[gradeOf(itemId)!];
  return `Lv ${level} ${school ? WEAPON_SCHOOL_NAMES[school] : "In Any School"}`;
}

export const gradeShopOpen = (itemId: GradeItemId, levels: MasteryLevels) => gradeShopLevel(itemId, levels) >= GRADE_MASTERY_LEVEL[gradeOf(itemId)!];

/** The Smith's price in gold, or undefined for anything he does not sell. */
export const gradeShopPrice = (itemId: unknown) => {
  const grade = isGradeItemId(itemId) ? gradeOf(itemId) : undefined;
  return grade ? GRADE_GOLD_PRICE[grade] : undefined;
};

/** What a line offers: the grade after the best one held, or the top grade, already held. */
export function gradeShopOffer(line: GradeShopLine, held: ReadonlySet<string>) {
  let best = -1;
  for (const grade of GEAR_GRADES) if (held.has(gradeShopItemId(line, grade))) best = Math.max(best, gradeIndex(grade));
  const top = best >= GEAR_GRADES.length - 1;
  const grade = GEAR_GRADES[top ? best : best + 1];
  return { itemId: gradeShopItemId(line, grade), grade, owned: top };
}
