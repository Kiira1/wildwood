import {
  CRAFT_LEVEL, CRAFT_MAX_LEVEL, CRAFT_SKILLS, CRAFT_SKILL_NAMES, craftExperienceForLevel, craftLevel, craftMaterials, craftSkillFor,
  type CraftSkill, type Materials,
} from "./crafting";
import { armorClassOf, gradeEquipmentKindOf, gradeOf, isGradeItemId, type GradeItemId } from "./grade-equipment";
import { GRADE_SHOP_LINES, type GradeShopLine } from "./grade-shop";

/**
 * Graded gear by crafting (craft_grade_gear): which craft makes each piece, what it takes, and the craft level its
 * grade needs. Shared so the station windows and the server judge a craft the same way.
 */
export type CraftExperience = Readonly<Partial<Record<CraftSkill, number | bigint>>>;

/** The shop's lines each craft makes: Smithing swords and Medium and Heavy armor, and so on. */
const linesFor = (skill: CraftSkill) =>
  GRADE_SHOP_LINES.filter(line => craftSkillFor(line.kind, "armorClass" in line ? line.armorClass : undefined) === skill);
export const CRAFT_LINES: Readonly<Record<CraftSkill, readonly GradeShopLine[]>> = {
  smithing: linesFor("smithing"), fletching: linesFor("fletching"), enchanting: linesFor("enchanting"),
};

/** The craft that makes a graded piece, or undefined for any other item. */
export function gradeCraftSkill(itemId: unknown): CraftSkill | undefined {
  const kind = gradeEquipmentKindOf(itemId);
  return kind ? craftSkillFor(kind, armorClassOf(itemId)) : undefined;
}

/** What a graded piece takes to craft, or undefined for any other item. */
export function gradeCraftMaterials(itemId: unknown): Materials | undefined {
  const kind = gradeEquipmentKindOf(itemId), grade = gradeOf(itemId);
  return kind && grade ? craftMaterials(grade, kind, armorClassOf(itemId)) : undefined;
}

/** The craft level a piece's grade needs. */
export const gradeCraftLevel = (itemId: GradeItemId) => CRAFT_LEVEL[gradeOf(itemId)!];

/** The craft level a piece needs: "Lv 10 Fletching". */
export const gradeCraftNeed = (itemId: GradeItemId) => `Lv ${gradeCraftLevel(itemId)} ${CRAFT_SKILL_NAMES[gradeCraftSkill(itemId)!]}`;

/** Materials as one string, keys sorted, so the window's recipe and the server's compare exactly. */
export const craftMaterialsKey = (materials: Materials) =>
  JSON.stringify(Object.keys(materials).sort().map(id => [id, materials[id]]));

/** The materials short of what a piece takes, in the recipe's order. */
export const craftMaterialsShort = (materials: Materials, held: Readonly<Partial<Record<string, number>>>) =>
  Object.entries(materials).filter(([id, count]) => (held[id] ?? 0) < count).map(([id]) => id);

/** Each craft's level from its experience; a craft never practised is level 1. */
export const craftLevels = (experience: CraftExperience): Record<CraftSkill, number> =>
  Object.fromEntries(CRAFT_SKILLS.map(skill => [skill, craftLevel(experience[skill] ?? 0)])) as Record<CraftSkill, number>;

/** A craft's level and the experience into it, out of what the next level takes; none at the top. */
export function craftProgress(experience: number | bigint) {
  const value = Math.max(0, Number(experience) || 0), level = craftLevel(value);
  if (level >= CRAFT_MAX_LEVEL) return { level, into: 0, needed: 0 };
  const from = craftExperienceForLevel(level);
  return { level, into: value - from, needed: craftExperienceForLevel(level + 1) - from };
}

export const isCraftable = (itemId: unknown): itemId is GradeItemId => isGradeItemId(itemId) && gradeCraftSkill(itemId) !== undefined;
