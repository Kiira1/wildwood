// Lifetime session rows and the power numbers derived from progress: balance
// version stamping, effective power, and researched damage/armor/regen. Moved
// out of index.ts unchanged.
import { syncPlayerJoinDate } from "./mailbox";
import { syncWornSkill } from "./worn-skill";
import { cardStatFactors } from "../../shared/card-effects";
import { activeCardTotalsFor } from "./active-cards";
import { ATTACK_BALANCE_VERSION, MIN_ATTACK_INTERVAL, DEFAULT_ATTACK_INTERVAL } from "../../shared/rules";
import { compressLegacyProgressionOutlier, rebalanceLegacyDamageHealth, compressLegacyTopFiveProgression, correctLegacyTopFiveV5Progression } from "../../shared/progression-balance";
import { compressLegacyMapPower } from "../../shared/map-power-rescale";
import { rescaleEndgameProgress } from "../../shared/endgame-power-rescale";
import { playerPowerForStats, effectivePlayerPowerStats, effectivePlayerPower, legacyU32Power } from "../../shared/player-power";
import { withSoulStats, soulStatsFor, soulAttackCapFor } from "./soul-dimension";
import { critPowerFields } from "./crit-power";
import { researchInPlay } from "./bonus-toggles";
import { itemLevelFor, equippedRightHandForProgress, equippedLeftHandForProgress, equippedHeadForProgress, equippedChestForProgress, equippedFeetForProgress, equipmentPresentationForProgress } from "./progress-helpers";
import { readPlayerProgress } from "./wide-stats";
import { bootArmorFactor, equipmentDamage, equipmentRegeneration, hasBootStat } from "../../shared/items";
import { updateSnapshotRow, insertSnapshotRow } from "./snapshot-row-writes";
import { effectiveMovementSpeedForProgress } from "./player-speed";
import { syncPlayerMotionIdentity, playerWithMotion } from "./presence-runtime";
import { createAutoEquip } from "./auto-equip";
import { inventoryForProgress } from "./progress-helpers";

export function ensurePlayerLifetime(ctx: any) {
  const current = ctx.db.playerLifetime.identity.find(ctx.sender);
  if (current) return current;
  const next = {
    identity: ctx.sender,
    joinedAt: ctx.timestamp,
    playedMicros: 0n,
    sessionStartedAt: ctx.timestamp,
    enemyKills: 0n,
    deathCount: 0n,
  };
  ctx.db.playerLifetime.insert(next);
  syncPlayerJoinDate(ctx, ctx.sender, next.joinedAt);
  return next;
}

export function finishLifetimeSession(ctx: any, identity: any) {
  // Their last minutes of play reach the leaderboard at its next snapshot, though they are offline by then.
  if (ctx.db.leaderboardDirty && !ctx.db.leaderboardDirty.identity.find(identity)) ctx.db.leaderboardDirty.insert({ identity });
  const lifetime = ctx.db.playerLifetime.identity.find(identity);
  if (!lifetime) return;
  const elapsed = ctx.timestamp.microsSinceUnixEpoch - lifetime.sessionStartedAt.microsSinceUnixEpoch;
  ctx.db.playerLifetime.identity.update({
    ...lifetime,
    playedMicros: lifetime.playedMicros + (elapsed > 0n ? elapsed : 0n),
    sessionStartedAt: ctx.timestamp,
  });
}

export function markPlayerBalanceCurrent(ctx: any, identity = ctx.sender) {
  const current = ctx.db.playerBalanceVersion.identity.find(identity);
  const next = { identity, version: ATTACK_BALANCE_VERSION };
  if (current) ctx.db.playerBalanceVersion.identity.update(next);
  else ctx.db.playerBalanceVersion.insert(next);
}

export function playerBalanceProgress(progress: any, version: number, includeMapRebase = true) {
  const attackBalanced = {
    ...progress,
    // Version 1 halved legacy attack speed once. Version 2 enforces the lower
    // base-speed cap for existing players.
    attackRate: Math.max(
      MIN_ATTACK_INTERVAL,
      Math.min(DEFAULT_ATTACK_INTERVAL, version < 1 ? progress.attackRate * 2 : progress.attackRate),
    ),
  };
  const outlierBalanced = version < 3 ? compressLegacyProgressionOutlier(attackBalanced) : attackBalanced;
  const damageHealthBalanced = version < 4 ? rebalanceLegacyDamageHealth(outlierBalanced) : outlierBalanced;
  const topFiveBalanced = version < 5 ? compressLegacyTopFiveProgression(damageHealthBalanced) : damageHealthBalanced;
  const corrected = version === 5 ? correctLegacyTopFiveV5Progression(topFiveBalanced) : topFiveBalanced;
  const mapBalanced = includeMapRebase && version < 7 ? compressLegacyMapPower(corrected) : corrected;
  return includeMapRebase && version < 8 ? rescaleEndgameProgress(mapBalanced) : mapBalanced;
}

export function powerForProgress(progress: { maxHp: number; damage: number; attackRate: number; armor: number; regen: number }) {
  return playerPowerForStats(progress);
}

export function effectivePowerStatsForProgress(ctx: any, progress: any) {
  return effectivePlayerPowerStats(
    { ...withSoulStats(progress, soulStatsFor(ctx, progress.identity), soulAttackCapFor(ctx, progress.identity)), ...critPowerFields(ctx, progress.identity, progress.critRating) },
    researchInPlay(ctx, progress.identity),
    (itemId) => itemLevelFor(ctx, progress.identity, itemId),
    activeCardTotalsFor(ctx, progress.identity),
  );
}

export function effectivePowerForProgress(ctx: any, progress: any) {
  return effectivePlayerPower(
    { ...withSoulStats(progress, soulStatsFor(ctx, progress.identity), soulAttackCapFor(ctx, progress.identity)), ...critPowerFields(ctx, progress.identity, progress.critRating) },
    researchInPlay(ctx, progress.identity),
    (itemId) => itemLevelFor(ctx, progress.identity, itemId),
    activeCardTotalsFor(ctx, progress.identity),
  );
}

export function powerFieldsForProgress(ctx: any, progress: any) {
  const powerLevel = effectivePowerForProgress(ctx, progress);
  return { power: legacyU32Power(powerLevel), powerLevel };
}

export function researchedDamage(ctx: any, identity: any, damage: number, knownProgress?: any, knownResearch?: any) {
  const rank = (knownResearch === undefined ? researchInPlay(ctx, identity) : knownResearch)?.warcraft ?? 0;
  const progress = knownProgress ?? readPlayerProgress(ctx, identity);
  const weaponItem = progress ? equippedRightHandForProgress(progress) || equippedLeftHandForProgress(progress) : "";
  const headItem = progress ? equippedHeadForProgress(progress) : "";
  const chestItem = progress ? equippedChestForProgress(progress) : "";
  const levels = [itemLevelFor(ctx, identity, weaponItem), itemLevelFor(ctx, identity, headItem), itemLevelFor(ctx, identity, chestItem)] as const;
  // Active attack cards multiply it as they multiply power (player-power.ts).
  return equipmentDamage(damage + (soulStatsFor(ctx, identity)?.damage ?? 0),
    weaponItem,
    headItem,
    chestItem,
    1 + rank * .02,
    ...levels,
  ) * cardStatFactors(activeCardTotalsFor(ctx, identity)).damage;
}

export function researchedArmor(ctx: any, identity: any, armor: number) {
  const rank = researchInPlay(ctx, identity)?.precision ?? 0;
  // Warrior Boots multiply armor before research, as player-power.ts orders it.
  const progress = readPlayerProgress(ctx, identity), feet = progress ? equippedFeetForProgress(progress) : "";
  const boots = hasBootStat(feet) ? bootArmorFactor(feet, itemLevelFor(ctx, identity, feet)) : 1;
  return (armor + (soulStatsFor(ctx, identity)?.armor ?? 0)) * boots * (1 + rank * .02) * cardStatFactors(activeCardTotalsFor(ctx, identity)).armor;
}

export function researchedRegen(ctx: any, identity: any, regen: number) {
  const rank = researchInPlay(ctx, identity)?.regeneration ?? 0;
  const progress = readPlayerProgress(ctx, identity);
  const headItem = progress ? equippedHeadForProgress(progress) : "";
  const chestItem = progress ? equippedChestForProgress(progress) : "";
  return equipmentRegeneration(regen + (soulStatsFor(ctx, identity)?.regen ?? 0),
    headItem,
    chestItem,
    1 + rank * .02,
    itemLevelFor(ctx, identity, headItem),
    itemLevelFor(ctx, identity, chestItem),
  ) * cardStatFactors(activeCardTotalsFor(ctx, identity)).regen;
}

export function writeProgressAndPresentation(ctx: any, progress: any) {
  const current = readPlayerProgress(ctx, progress.identity);
  if (current) updateSnapshotRow(ctx, "playerProgress", progress);
  else insertSnapshotRow(ctx, "playerProgress", progress);
  const active = ctx.db.player.identity.find(progress.identity);
  if (active) {
    const nextPlayer = {
      ...active,
      ...powerFieldsForProgress(ctx, progress),
      speed: effectiveMovementSpeedForProgress(ctx, progress),
      ...equipmentPresentationForProgress(ctx, progress),
    };
    updateSnapshotRow(ctx, "player", nextPlayer);
    syncPlayerMotionIdentity(ctx, playerWithMotion(ctx, nextPlayer));
  }
  syncWornSkill(ctx, progress.identity, progress);
  // Ranking snapshots refresh in maintenance, never in the combat/reward path.
}

export const autoEquip = createAutoEquip({ inventoryForProgress, itemUpgradeLevelFor: itemLevelFor, writeProgressAndPresentation });
