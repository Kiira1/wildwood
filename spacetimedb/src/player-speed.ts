import { CHALLENGE_ABSOLUTE_MIN_INTERVAL } from "../../shared/prestige-challenge";
import { effectivePlayerMovementSpeed } from "../../shared/rules";
import { prestigePerkValue } from "../../shared/prestige-perks";
import { attackRangeWithResearch } from "../../shared/utility-research";
import { updateSnapshotRow } from "./snapshot-row-writes";
import { readPlayerProgress } from "./wide-stats";
import { aggroChallengeActive } from "./aggro-challenge";
import { bonusOffFor, researchInPlay } from "./bonus-toggles";
import { perksInPlayFor } from "../../shared/bonus-toggles";

/** The server's saved movement speed, including both research trees. */
export function effectiveMovementSpeedForProgress(ctx: any, progress: any, research?: any) {
  const ranks = research ?? researchInPlay(ctx, progress.identity);
  return effectivePlayerMovementSpeed(
    false,
    ranks?.moveSpeed ?? 0,
    progress.speedOverride ?? 0,
    ranks?.utilityMoveSpeed ?? 0,
  ) * (1 + prestigePerkValue(perksInPlay(ctx, progress.identity), "fleetFoot"));
}

/** Saved range includes research and Long Shot, while base stat totals stay unchanged. */
export function prestigeRangeBonus(ctx: any, identity: any) {
  return prestigePerkValue(perksInPlay(ctx, identity), "longShot");
}

/** The range saved on player_progress: range research and Long Shot, each only while in play (bonus-toggles.ts). */
export function savedAttackRange(ctx: any, identity: any) {
  return attackRangeWithResearch(researchInPlay(ctx, identity)?.utilityAttackRange ?? 0) + prestigeRangeBonus(ctx, identity);
}

/** Fleet Foot and Long Shot's row, or none during an Aggro run, which plays without prestige bonuses; a switched-off perk reads zero. */
function perksInPlay(ctx: any, identity: any) {
  const row = aggroChallengeActive(ctx, identity) ? null : ctx.db.playerPrestigeExpansionPerk.identity.find(identity);
  return row ? perksInPlayFor(row, bonusOffFor(ctx, identity)) : null;
}

/** Refresh saved range and live movement immediately when a perk point is spent. */
export function refreshPrestigeMovement(ctx: any, activePlayer: any, syncMotion: (player: any) => void) {
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress) return;
  const next = { ...progress, attackRange: savedAttackRange(ctx, ctx.sender) };
  updateSnapshotRow(ctx, "playerProgress", next);
  const player = { ...activePlayer, speed: effectiveMovementSpeedForProgress(ctx, next) };
  updateSnapshotRow(ctx, "player", player);
  syncMotion(player);
}

export function attackIntervalForProgress(progress: any) {
  return Math.max(CHALLENGE_ABSOLUTE_MIN_INTERVAL, progress.attackRate);
}
