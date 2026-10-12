import { CHALLENGE_ABSOLUTE_MIN_INTERVAL } from "./prestige-challenge";
import { DEFAULT_ATTACK_INTERVAL, PLAYER_BASE_DAMAGE, PLAYER_BASE_HP, PLAYER_BASE_REGEN } from "./rules";
import {
  equipmentDamageMultiplierBonus,
  equipmentMaxHealthMultiplierBonus,
  equipmentRegenerationMultiplierBonus,
} from "./items";

export type PlayerPowerStats = {
  maxHp: number;
  damage: number;
  attackRate: number;
  armor: number;
  regen: number;
  /** The run's crit damage rating (stat-rating.ts), where a caller tracks it. Not part of power itself. */
  critRating?: number;
  /**
   * Crit chance (0–1) and the crit multiplier in play, where the caller knows them: power counts damage at
   * its average hit, crits included (critPowerFactor). Without them a hit is plain damage, as before.
   */
  critChance?: number;
  critMultiplier?: number;
};

/**
 * What crits multiply the average hit by: 1 + chance × (multiplier − 1), as duels count them. Power ignored
 * crit, so a crit build read far weaker than it was and Auto Farm held it back (Ryan, 0.901.57).
 */
export function critPowerFactor(stats: Pick<PlayerPowerStats, "critChance" | "critMultiplier">) {
  const chance = Number.isFinite(stats.critChance) ? Math.min(1, Math.max(0, Number(stats.critChance))) : 0;
  const multiplier = Number.isFinite(stats.critMultiplier) ? Math.max(1, Number(stats.critMultiplier)) : 1;
  return 1 + chance * (multiplier - 1);
}

/**
 * The stats kills raise, as a new run starts them: a new account, a prestige
 * and a perk respec all set them back to these.
 */
export const PLAYER_STARTING_POWER: Readonly<PlayerPowerStats> = Object.freeze({
  maxHp: PLAYER_BASE_HP, damage: PLAYER_BASE_DAMAGE, attackRate: DEFAULT_ATTACK_INTERVAL, armor: 0, regen: PLAYER_BASE_REGEN, critRating: 0,
});

export type PlayerPowerProgress = PlayerPowerStats & {
  equippedHead?: string;
  equippedChest?: string;
  equippedRightHand?: string;
  equippedLeftHand?: string;
};

export type PlayerPowerResearch = {
  warcraft?: number;
  vitality?: number;
  precision?: number;
  regeneration?: number;
};

type ItemUpgradeLevel = (itemId: string) => number;

function researchRank(value: unknown) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0;
}

/** One canonical effective-stat calculation for profile, world, and leaderboard power. */
export function effectivePlayerPowerStats(
  progress: PlayerPowerProgress,
  research: PlayerPowerResearch | null | undefined = null,
  itemUpgradeLevel: ItemUpgradeLevel = () => 0,
): PlayerPowerStats {
  return preparePlayerPowerStats(progress, research, itemUpgradeLevel)(progress);
}

/** Resolve fixed gear/research once; reuse while only the earned base stats change.
 * Keep equipment and research factors separate to preserve floating-point order.
 */
export function preparePlayerPowerStats(
  loadout: PlayerPowerProgress,
  research: PlayerPowerResearch | null | undefined = null,
  itemUpgradeLevel: ItemUpgradeLevel = () => 0,
): (progress: PlayerPowerStats) => PlayerPowerStats {
  const weaponItem = loadout.equippedRightHand || loadout.equippedLeftHand || "";
  const headItem = loadout.equippedHead || "";
  const chestItem = loadout.equippedChest || "";
  const weaponLevel = itemUpgradeLevel(weaponItem);
  const headLevel = itemUpgradeLevel(headItem);
  const chestLevel = itemUpgradeLevel(chestItem);
  // Vitality multiplies saved health live, like every other research (0.883).
  // It used to be baked into the saved number by the client at each rank-up,
  // which the server stopped accepting in 0.695, so ranks since did nothing.
  const health = 1 + equipmentMaxHealthMultiplierBonus(headItem, chestItem, headLevel, chestLevel);
  const damage = 1 + equipmentDamageMultiplierBonus(weaponItem, headItem, chestItem, weaponLevel, headLevel, chestLevel);
  const regen = 1 + equipmentRegenerationMultiplierBonus(headItem, chestItem, headLevel, chestLevel);
  const vitality = 1 + researchRank(research?.vitality) * .02;
  const warcraft = 1 + researchRank(research?.warcraft) * .02;
  const precision = 1 + researchRank(research?.precision) * .02;
  const regeneration = 1 + researchRank(research?.regeneration) * .02;
  return progress => ({
    maxHp: progress.maxHp * health * vitality,
    damage: progress.damage * damage * warcraft,
    attackRate: Math.max(CHALLENGE_ABSOLUTE_MIN_INTERVAL, progress.attackRate),
    armor: progress.armor * precision,
    regen: progress.regen * regen * regeneration,
    // Crit passes through as given (it is worked out from research, perks, the soul and the rating elsewhere).
    ...(progress.critChance !== undefined ? { critChance: progress.critChance } : {}),
    ...(progress.critMultiplier !== undefined ? { critMultiplier: progress.critMultiplier } : {}),
  });
}

export function effectivePlayerPower(
  progress: PlayerPowerProgress,
  research?: PlayerPowerResearch | null,
  itemUpgradeLevel?: ItemUpgradeLevel,
) {
  return playerPowerForStats(effectivePlayerPowerStats(progress, research, itemUpgradeLevel));
}

export function playerPowerForStats(stats: PlayerPowerStats) {
  return Math.round(unroundedPlayerPower(stats));
}

/**
 * The same sum before rounding. Comparing two pieces of gear needs it: a
 * small weapon difference on a low-level player can round away entirely.
 */
export function unroundedPlayerPower(stats: PlayerPowerStats) {
  const attackSpeedMultiplier = DEFAULT_ATTACK_INTERVAL / Math.max(CHALLENGE_ABSOLUTE_MIN_INTERVAL, stats.attackRate);
  const power =
    stats.damage * critPowerFactor(stats) * attackSpeedMultiplier +
    stats.maxHp +
    stats.armor * 3 +
    stats.regen * 10;
  return Number.isFinite(power) ? Math.max(0, power) : 0;
}

export function legacyU32Power(power: number) {
  return Math.max(0, Math.min(0xffffffff, Math.round(power)));
}
