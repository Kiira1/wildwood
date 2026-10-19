import { GRADE_GOLD_PRICE, type ArmorClass } from "../../shared/gear-grades";
import type { GradeItemId, GradeWeaponKind } from "../../shared/grade-equipment";
import { gradeShopOffer, gradeShopOpen, masteryLevels, type GradeShopLine } from "../../shared/grade-shop";
import { weaponSchool, type WeaponSchool } from "../../shared/weapon-mastery";

/** Each school's Mastery points, as the sims keep them. */
export type MasteryPointsBySchool = Partial<Record<WeaponSchool, number>>;

const SCHOOL_WEAPON_LINE: Readonly<Record<WeaponSchool, GradeWeaponKind>> = { archery: "bow", swordplay: "sword", sorcery: "staff" };
const SCHOOL_ARMOR_CLASS: Readonly<Record<WeaponSchool, ArmorClass>> = { archery: "light", swordplay: "medium", sorcery: "magic" };

/** The Smith's lines a build follows: its weapon's kind, and the helmet and armor of its school's class (the set). */
export function gradeShopLinesFor(weapon: string): GradeShopLine[] {
  const school = weaponSchool(weapon), armorClass = SCHOOL_ARMOR_CLASS[school];
  return [{ kind: SCHOOL_WEAPON_LINE[school] }, { kind: "armor", armorClass }, { kind: "helmet", armorClass }];
}

/**
 * What a sim's player buys next: the next grade on one of its lines that Mastery opens and the gold covers, the
 * cheapest first (weapon, armor, then helmet on a tie). None when nothing is open and affordable.
 */
export function nextSmithPurchase(weapon: string, owned: ReadonlySet<string>, gold: number, points: MasteryPointsBySchool) {
  const levels = masteryLevels(points);
  let best: { itemId: GradeItemId; price: number } | null = null;
  for (const line of gradeShopLinesFor(weapon)) {
    const offer = gradeShopOffer(line, owned), price = GRADE_GOLD_PRICE[offer.grade];
    if (offer.owned || price > gold || !gradeShopOpen(offer.itemId, levels)) continue;
    if (!best || price < best.price) best = { itemId: offer.itemId, price };
  }
  return best;
}
