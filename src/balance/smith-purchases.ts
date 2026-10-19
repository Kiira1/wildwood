import { GRADE_GOLD_PRICE, type ArmorClass } from "../../shared/gear-grades";
import type { GradeItemId, GradeWeaponKind } from "../../shared/grade-equipment";
import { bestHeldGradeIndex, gradeShopOffer, masteryLevels, type GradeShopLine } from "../../shared/grade-shop";
import { weaponSchool, type WeaponSchool } from "../../shared/weapon-mastery";

/**
 * How often a sim's player stops at the Smith while farming, besides after a boss: gold saves up between visits, so a
 * visit can skip grades. Shopping after every kill would buy each grade the moment it is affordable.
 */
export const SMITH_VISIT_SECONDS = 30 * 60;

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
 * What a sim's player buys next: on one of its lines, the best grade Mastery opens that the gold covers, once it
 * beats what that line holds (the grades between skipped). The cheapest first; on a tie the line furthest behind
 * goes first (then weapon, armor, helmet), or the weapon would take every newly opened grade and starve the rest.
 * None when nothing open is affordable.
 */
export function nextSmithPurchase(weapon: string, owned: ReadonlySet<string>, gold: number, points: MasteryPointsBySchool) {
  const levels = masteryLevels(points);
  let best: { itemId: GradeItemId; price: number; held: number } | null = null;
  for (const line of gradeShopLinesFor(weapon)) {
    const offer = gradeShopOffer(line, owned, levels, gold), price = GRADE_GOLD_PRICE[offer.grade], held = bestHeldGradeIndex(line, owned);
    if (!offer.open || price > gold) continue;
    if (!best || price < best.price || (price === best.price && held < best.held)) best = { itemId: offer.itemId, price, held };
  }
  return best && { itemId: best.itemId, price: best.price };
}
