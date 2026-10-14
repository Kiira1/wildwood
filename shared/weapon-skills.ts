import { BOW_SKILL_IDS, NO_BOW_SKILLS, bowSkillLines, bowSkillScore, isSkillBow, rollBowSkills, type BowSkillRoll } from "./bow-skills";
import { NO_SWORD_SKILLS, SWORD_SKILL_IDS, isSkillSword, rollSwordSkills, swordSkillLines, swordSkillScore, type SwordSkillRoll } from "./sword-skills";

/** Kept copies and offers carry either kind of weapon's roll. */
export type WeaponSkillRoll = Partial<BowSkillRoll & SwordSkillRoll>;
export const isSkillWeapon = (itemId: unknown) => isSkillBow(itemId) || isSkillSword(itemId);
export const rollWeaponSkills = (itemId: unknown, random: () => number): WeaponSkillRoll =>
  rollBowSkills(itemId, random) ?? rollSwordSkills(itemId, random) ?? NO_BOW_SKILLS;
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

/** Whether `next` is at least as good as `current` on every skill and better on one: a pure upgrade, no trade-off. */
export function rollBeatsOnEverySkill(itemId: unknown, next: WeaponSkillRoll | null | undefined, current: WeaponSkillRoll | null | undefined) {
  const skills: readonly (keyof WeaponSkillRoll)[] = isSkillSword(itemId) ? SWORD_SKILL_IDS : isSkillBow(itemId) ? BOW_SKILL_IDS : [];
  const value = (roll: WeaponSkillRoll | null | undefined, skill: keyof WeaponSkillRoll) => Number(roll?.[skill] ?? 0) || 0;
  return skills.every(skill => value(next, skill) >= value(current, skill)) && skills.some(skill => value(next, skill) > value(current, skill));
}
