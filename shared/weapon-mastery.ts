import { weaponKind, type WeaponKind } from "./equip-best";

/**
 * Weapon Mastery: each weapon type is a school with its own level, earned by fighting with it. Prestige keeps it;
 * Reset Save clears it. Levels will unlock gear grades and school techniques.
 */
export const WEAPON_SCHOOLS = ["archery", "swordplay", "sorcery"] as const;
export type WeaponSchool = typeof WEAPON_SCHOOLS[number];

export const WEAPON_SCHOOL_NAMES: Readonly<Record<WeaponSchool, string>> = { archery: "Archery", swordplay: "Swordplay", sorcery: "Sorcery" };

const SCHOOL_BY_KIND: Readonly<Record<WeaponKind, WeaponSchool>> = { RANGED: "archery", MELEE: "swordplay", MAGIC: "sorcery" };

/** The school a weapon trains: bows and the starter stone Archery, swords Swordplay, staffs Sorcery. */
export const weaponSchool = (itemId: string | undefined): WeaponSchool => SCHOOL_BY_KIND[weaponKind(itemId)];

export const isWeaponSchool = (value: unknown): value is WeaponSchool => (WEAPON_SCHOOLS as readonly unknown[]).includes(value);

/** Points a kill gives the school of the weapon in hand; a boss's first clear in a run gives more. */
export const MASTERY_POINTS_PER_KILL = 1;
export const MASTERY_POINTS_PER_BOSS = 50;

export const MASTERY_MAX_LEVEL = 50;
/** Level 1 costs this many points; each level after costs MASTERY_LEVEL_GROWTH times the last. */
export const MASTERY_FIRST_LEVEL_POINTS = 1_000;
export const MASTERY_LEVEL_GROWTH = 1.11;

/** Total points to reach `level` (0 at level 0): about 16,700 for 10 and 1.67 million for 50. */
export function masteryPointsForLevel(level: number) {
  const clamped = Math.max(0, Math.min(MASTERY_MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 0)));
  let total = 0;
  for (let next = 0; next < clamped; next++) total += Math.round(MASTERY_FIRST_LEVEL_POINTS * MASTERY_LEVEL_GROWTH ** next);
  return total;
}

const LEVEL_TOTALS = Array.from({ length: MASTERY_MAX_LEVEL + 1 }, (_, level) => masteryPointsForLevel(level));

/** The level `points` reach, 0 to MASTERY_MAX_LEVEL. */
export function masteryLevel(points: number | bigint) {
  const value = Math.max(0, Number(points) || 0);
  let level = 0;
  while (level < MASTERY_MAX_LEVEL && value >= LEVEL_TOTALS[level + 1]) level++;
  return level;
}

/** Where `points` stand: the level, the points into it and the points it takes (0 at the top level). */
export function masteryProgress(points: number | bigint) {
  const value = Math.max(0, Number(points) || 0), level = masteryLevel(value);
  if (level >= MASTERY_MAX_LEVEL) return { level, into: 0, needed: 0 };
  return { level, into: value - LEVEL_TOTALS[level], needed: LEVEL_TOTALS[level + 1] - LEVEL_TOTALS[level] };
}

/** The points one accepted kill report earns: every kill, plus a boss cleared for the first time this run. */
export const masteryPointsForReport = (kills: number, firstBossClear: boolean) =>
  Math.max(0, Math.floor(Number.isFinite(kills) ? kills : 0)) * MASTERY_POINTS_PER_KILL + (firstBossClear ? MASTERY_POINTS_PER_BOSS : 0);
