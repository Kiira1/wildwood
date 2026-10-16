import { BOW_SKILL_IDS, NO_BOW_SKILLS, bowSkillLines, bowSkillScore, isSkillBow, rollBowSkills, type BowSkillRoll } from "./bow-skills";
import { NO_SWORD_SKILLS, SWORD_SKILL_IDS, isSkillSword, rollSwordSkills, swordSkillLines, swordSkillScore, type SwordSkillRoll } from "./sword-skills";

/** Kept copies and offers carry either kind of weapon's roll. */
export type WeaponSkillRoll = Partial<BowSkillRoll & SwordSkillRoll>;
export const isSkillWeapon = (itemId: unknown) => isSkillBow(itemId) || isSkillSword(itemId);
export const rollWeaponSkills = (itemId: unknown, random: () => number, skillLuckRank = 0): WeaponSkillRoll =>
  rollBowSkills(itemId, random, skillLuckRank) ?? rollSwordSkills(itemId, random, skillLuckRank) ?? NO_BOW_SKILLS;
export const weaponSkillScore = (itemId: unknown, roll: WeaponSkillRoll | null | undefined) =>
  isSkillSword(itemId) ? swordSkillScore(roll) : isSkillBow(itemId) ? bowSkillScore(roll) : 0;
export const weaponSkillLines = (itemId: unknown, roll: WeaponSkillRoll | null | undefined) =>
  isSkillSword(itemId) ? swordSkillLines(roll) : isSkillBow(itemId) ? bowSkillLines(roll) : [];

/** The stable columns on copy and offer rows; the other weapon kind stays zero. */
export const weaponSkillColumns = (roll: WeaponSkillRoll) => ({ ...NO_BOW_SKILLS, ...NO_SWORD_SKILLS, ...roll });
export function weaponSkillRollOf(row: WeaponSkillRoll & { itemId: string }): WeaponSkillRoll {
  return isSkillSword(row.itemId)
    ? { whirlwind: row.whirlwind ?? 0, deflect: row.deflect ?? 0, shockwave: row.shockwave ?? 0 }
    : { arrowStorm: row.arrowStorm ?? 0, ricochet: row.ricochet ?? 0, piercingShot: row.piercingShot ?? 0 };
}

/**
 * A duplicate's roll merged into the held one, so a skill never goes down and one skill is never traded for
 * another. A roll at least as good on every skill takes over outright; otherwise it only adds the skills the
 * weapon lacks, at the drop's chance. Null when nothing would change.
 */
export function mergeSkillRolls(itemId: unknown, current: WeaponSkillRoll | null | undefined, next: WeaponSkillRoll | null | undefined): WeaponSkillRoll | null {
  const skills: readonly (keyof WeaponSkillRoll)[] = isSkillSword(itemId) ? SWORD_SKILL_IDS : isSkillBow(itemId) ? BOW_SKILL_IDS : [];
  const value = (roll: WeaponSkillRoll | null | undefined, skill: keyof WeaponSkillRoll) => Number(roll?.[skill] ?? 0) || 0;
  const everyBetter = skills.every(skill => value(next, skill) >= value(current, skill));
  const merged = Object.fromEntries(skills.map(skill => [skill,
    everyBetter || value(current, skill) === 0 ? Math.max(value(current, skill), value(next, skill)) : value(current, skill)])) as WeaponSkillRoll;
  return skills.some(skill => value(merged, skill) !== value(current, skill)) ? merged : null;
}
