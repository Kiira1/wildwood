import { canonicalItemId, isUpgradeableItem, itemDefinition } from "./items";
import { itemTier } from "./item-tier";
import { REFINE_MAX, normalizeRefineLevel } from "./refine-multiplier";
export { REFINE_MAX, REFINE_STEP_PAST_TEN, REFINE_STEP_TO_TEN, normalizeRefineLevel, refineMultiplier } from "./refine-multiplier";

/**
 * Refining, after Ragnarok Online: every item refines on its own from +0 to +30 at the
 * Town anvil, one ore a try, decided on the spot. Up to its safe limit a try always works; past it the odds
 * fall, and a failed try costs only its ore: the item keeps its level. Gems never buy odds or protection.
 *
 * This is its own layer. The slot tiers (+N on the Weapon, Helmet and Armor tracks) stay as they were.
 */

/** Ragnarok's weapon levels: an item's grade follows its Tier, four tiers to a grade (the last one three). */
export type RefineGrade = 1 | 2 | 3 | 4;

/** The ore a try costs: one grade ore, plus a Starshard from +11 on. */
export const REFINE_ORES = {
  copper_ore: { name: "Copper Ore", grade: 1 },
  iron_ore: { name: "Iron Ore", grade: 2 },
  mithril_ore: { name: "Mithril Ore", grade: 3 },
  adamant_ore: { name: "Adamant Ore", grade: 4 },
  starshard: { name: "Starshard", grade: null },
} as const;
export type OreId = keyof typeof REFINE_ORES;
export const GRADE_ORES: Readonly<Record<RefineGrade, OreId>> = { 1: "copper_ore", 2: "iron_ore", 3: "mithril_ore", 4: "adamant_ore" };
/** From this level on, a try also takes a Starshard. */
export const STARSHARD_FROM_LEVEL = 11;

/**
 * Where a try stops being certain. Weapons as Ragnarok's weapon levels: the higher the grade, the lower the
 * limit. Helmets and armor are +4 at every grade, as Ragnarok's armor.
 */
export const WEAPON_SAFE_LIMITS: Readonly<Record<RefineGrade, number>> = { 1: 7, 2: 6, 3: 5, 4: 4 };
export const ARMOR_SAFE_LIMIT = 4;

/**
 * The chance a try past the safe limit works, by the level it is for: Ragnarok's classic table to +10 (rounded),
 * then lower still to +30. A fail costs only the ore, so a level takes one over its chance in tries: a top-grade
 * item about 27 tries to +10, about 175 to +20 and about 530 to +30, every try from +11 a Starshard as well.
 */
const WEAPON_ODDS: Readonly<Record<RefineGrade, Readonly<Record<number, number>>>> = {
  1: { 8: .6, 9: .4, 10: .2 },
  2: { 7: .6, 8: .4, 9: .2, 10: .2 },
  3: { 6: .6, 7: .5, 8: .2, 9: .2, 10: .2 },
  4: { 5: .6, 6: .4, 7: .4, 8: .2, 9: .2, 10: .1 },
};
const ARMOR_ODDS: Readonly<Record<number, number>> = { 5: .6, 6: .6, 7: .4, 8: .4, 9: .2, 10: .1 };
/** Past +10, never better than the +10 try was for that item. */
const HIGH_ODDS: Readonly<Record<number, number>> = { 11: .1, 12: .1, 13: .08, 14: .08, 15: .07, 16: .07, 17: .06, 18: .06, 19: .05, 20: .05,
  21: .04, 22: .04, 23: .035, 24: .035, 25: .03, 26: .03, 27: .025, 28: .025, 29: .02, 30: .02 };

/** Equipment with a stat to refine: every bow, sword, helmet and armor with a bonus. Cosmetics and the starter stone have none. */
/** The ore a piece of gear gives back when destroyed: one of its refine grade's ore. Null for anything else. */
export function salvageOre(itemId: unknown): OreId | null {
  const grade = refineGrade(itemId);
  return grade ? GRADE_ORES[grade] : null;
}

export function isRefinableItem(itemId: unknown) {
  return isUpgradeableItem(itemId);
}

export function refineGrade(itemId: unknown): RefineGrade | null {
  const id = canonicalItemId(itemId);
  if (!id || !isRefinableItem(id)) return null;
  const tier = itemTier(id) ?? itemDefinition(id)?.weapon?.tier ?? 1;
  return tier <= 4 ? 1 : tier <= 8 ? 2 : tier <= 12 ? 3 : 4;
}

export function refineSafeLimit(itemId: unknown) {
  const grade = refineGrade(itemId);
  if (!grade) return 0;
  return itemDefinition(itemId)?.slot === "HAND" ? WEAPON_SAFE_LIMITS[grade] : ARMOR_SAFE_LIMIT;
}

/** The chance a try for `toLevel` works: certain up to the safe limit, then the tables above. Zero when it can't be tried. */
export function refineSuccessChance(itemId: unknown, toLevel: number) {
  const grade = refineGrade(itemId);
  if (!grade || !Number.isInteger(toLevel) || toLevel < 1 || toLevel > REFINE_MAX) return 0;
  if (toLevel <= refineSafeLimit(itemId)) return 1;
  if (toLevel > 10) return HIGH_ODDS[toLevel] ?? 0;
  const table = itemDefinition(itemId)?.slot === "HAND" ? WEAPON_ODDS[grade] : ARMOR_ODDS;
  return table[toLevel] ?? 0;
}

/** What a try for `toLevel` costs, or null when the item can't be refined to it. */
export function refineCost(itemId: unknown, toLevel: number): Partial<Record<OreId, number>> | null {
  const grade = refineGrade(itemId);
  if (!grade || !Number.isInteger(toLevel) || toLevel < 1 || toLevel > REFINE_MAX) return null;
  const cost: Partial<Record<OreId, number>> = { [GRADE_ORES[grade]]: 1 };
  if (toLevel >= STARSHARD_FROM_LEVEL) cost.starshard = 1;
  return cost;
}

/** Where a try leaves the item: one up when it works, where it was when it fails. Tries within the safe limit never fail. */
export function refineResultLevel(currentLevel: number, succeeded: boolean) {
  const current = normalizeRefineLevel(currentLevel);
  return succeeded ? Math.min(REFINE_MAX, current + 1) : current;
}

/**
 * The expected number of tries to bring an item from +0 to each level, failures included: index n holds the
 * tries to reach +n. For the refine window's "about N tries" and the balance checks.
 */
export function expectedRefineTries(itemId: unknown): number[] {
  const totals = [0];
  let total = 0;
  for (let level = 1; level <= REFINE_MAX; level++) {
    const chance = refineSuccessChance(itemId, level);
    // A fail keeps the level, so a level takes one over its chance in tries.
    total += chance > 0 ? 1 / chance : Number.POSITIVE_INFINITY;
    totals.push(total);
  }
  return totals;
}

/**
 * Rolls one try. `roll` is a number in [0, 1) from the server's random source; a try works when it lands
 * under the chance. Returns the level the item ends on.
 */
export function rollRefine(itemId: unknown, currentLevel: number, roll: number) {
  const current = normalizeRefineLevel(currentLevel);
  const succeeded = roll < refineSuccessChance(itemId, current + 1);
  return { succeeded, level: refineResultLevel(current, succeeded) };
}
