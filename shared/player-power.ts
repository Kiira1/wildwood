import { CHALLENGE_ABSOLUTE_MIN_INTERVAL } from "./prestige-challenge";
import { DEFAULT_ATTACK_INTERVAL, PLAYER_BASE_DAMAGE, PLAYER_BASE_HP, PLAYER_BASE_REGEN } from "./rules";
import { cardStatFactors, cardTotals, type CardTotals } from "./card-effects";
import {
  bootArmorFactor,
  equipmentDamageFactor,
  equipmentMaxHealthMultiplierBonus,
  equipmentRegenerationMultiplierBonus,
  type ItemLevel,
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
 * crit, so a crit build read far weaker than it was and Auto Farm held it back.
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
  /** Boots: Warrior Boots raise armor (items.ts bootArmorFactor). */
  equippedFeet?: string;
  equippedRightHand?: string;
  equippedLeftHand?: string;
  /** The active cards in play (active-cards.ts); none is no card factor. */
  activeCards?: readonly string[];
};

export type PlayerPowerResearch = {
  warcraft?: number;
  vitality?: number;
  precision?: number;
  regeneration?: number;
};

/** An item's slot tier, or its slot tier and refine (items.ts ItemLevel). */
type ItemUpgradeLevel = (itemId: string) => ItemLevel;

function researchRank(value: unknown) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0;
}

/** One canonical effective-stat calculation for profile, world, and leaderboard power. */
export function effectivePlayerPowerStats(
  progress: PlayerPowerProgress,
  research: PlayerPowerResearch | null | undefined = null,
  itemUpgradeLevel: ItemUpgradeLevel = () => 0,
  cards?: CardTotals,
): PlayerPowerStats {
  return preparePlayerPowerStats(progress, research, itemUpgradeLevel, cards)(progress);
}

/** Resolve fixed gear/research once; reuse while only the earned base stats change.
 * Keep equipment and research factors separate to preserve floating-point order.
 */
export function preparePlayerPowerStats(
  loadout: PlayerPowerProgress,
  research: PlayerPowerResearch | null | undefined = null,
  itemUpgradeLevel: ItemUpgradeLevel = () => 0,
  /** The active cards added up, when the caller has them; otherwise the loadout's activeCards. */
  activeCardTotals?: CardTotals,
): (progress: PlayerPowerStats) => PlayerPowerStats {
  const weaponItem = loadout.equippedRightHand || loadout.equippedLeftHand || "";
  const headItem = loadout.equippedHead || "";
  const chestItem = loadout.equippedChest || "";
  const weaponLevel = itemUpgradeLevel(weaponItem);
  const headLevel = itemUpgradeLevel(headItem);
  const chestLevel = itemUpgradeLevel(chestItem);
  const feetItem = loadout.equippedFeet || "";
  // Vitality multiplies saved health live, like every other research (0.883).
  // It used to be baked into the saved number by the client at each rank-up,
  // which the server stopped accepting in 0.695, so ranks since did nothing.
  const health = 1 + equipmentMaxHealthMultiplierBonus(headItem, chestItem, headLevel, chestLevel);
  const damage = equipmentDamageFactor(weaponItem, headItem, chestItem, weaponLevel, headLevel, chestLevel);
  const regen = 1 + equipmentRegenerationMultiplierBonus(headItem, chestItem, headLevel, chestLevel);
  const armorGear = feetItem ? bootArmorFactor(feetItem, itemUpgradeLevel(feetItem)) : 1;
  const vitality = 1 + researchRank(research?.vitality) * .02;
  const warcraft = 1 + researchRank(research?.warcraft) * .02;
  const precision = 1 + researchRank(research?.precision) * .02;
  const regeneration = 1 + researchRank(research?.regeneration) * .02;
  // The active cards; a factor of one without any.
  const cards = cardStatFactors(activeCardTotals ?? cardTotals(loadout.activeCards ?? []));
  return progress => ({
    maxHp: progress.maxHp * health * vitality * cards.maxHp,
    damage: progress.damage * damage * warcraft * cards.damage,
    attackRate: Math.max(CHALLENGE_ABSOLUTE_MIN_INTERVAL, progress.attackRate),
    armor: progress.armor * armorGear * precision * cards.armor,
    regen: progress.regen * regen * regeneration * cards.regen,
    // Crit passes through as given (it is worked out from research, perks, the soul and the rating elsewhere).
    ...(progress.critChance !== undefined ? { critChance: progress.critChance } : {}),
    ...(progress.critMultiplier !== undefined ? { critMultiplier: progress.critMultiplier } : {}),
  });
}

export function effectivePlayerPower(
  progress: PlayerPowerProgress,
  research?: PlayerPowerResearch | null,
  itemUpgradeLevel?: ItemUpgradeLevel,
  cards?: CardTotals,
) {
  return playerPowerForStats(effectivePlayerPowerStats(progress, research, itemUpgradeLevel, cards));
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
