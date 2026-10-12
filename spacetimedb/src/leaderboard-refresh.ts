// Leaderboard snapshot: the full refresh maintenance runs, the queued request
// a player action can make, and the due check. Moved out of index.ts
// unchanged; the leaderboard tables and views stay there.
import { iterPlayerProgress } from "./wide-stats";
import { leaderboardEligible } from "../../shared/leaderboard-window";
import { effectivePowerStatsForProgress, powerForProgress } from "./player-power";
import { leaderboardAppearanceForProgress } from "./progress-helpers";
import { writeLeaderboardPages } from "./leaderboard-pages";
import { legacyU32Power } from "../../shared/player-power";

export const LEADERBOARD_REFRESH_INTERVAL_MICROS = 900_000_000n;

export const LEADERBOARD_REFRESH_VERSION = 13;

/** A version no build uses, so refreshLeaderboardIfDue rebuilds on its next pass. */
export const LEADERBOARD_REFRESH_QUEUED = 0;

export const LEADERBOARD_PLAYER_REFRESH_MIN_MICROS = 60_000_000n;

export function boundedMapPopulation(ctx: any, mapId: string) {
  return ctx.db.playerMotionMapState.mapId.find(mapId)?.playerCount ?? 0;
}

export function refreshLeaderboard(ctx: any) {
  const candidates: any[] = [];
  for (const progress of iterPlayerProgress(ctx) as Iterable<any>) {
    if (ctx.db.virtualPlayer.identity.find(progress.identity)) continue;
    // First runs join after the Dragon; a prestige level retains that credit
    // when the reset clears the current run's Desert access.
    const prestigeLevel = ctx.db.playerPrestige.identity.find(progress.identity)?.level ?? 0;
    if (!leaderboardEligible(progress.desertUnlocked, prestigeLevel)) continue;
    const profile = ctx.db.playerProfile.identity.find(progress.identity);
    if (!profile) continue;
    const current = ctx.db.leaderboardEntry.identity.find(progress.identity);
    const lifetime = ctx.db.playerLifetime.identity.find(progress.identity);
    const active = ctx.db.player.identity.find(progress.identity);
    const activeMicros = lifetime && active
      ? ctx.timestamp.microsSinceUnixEpoch - lifetime.sessionStartedAt.microsSinceUnixEpoch
      : 0n;
    const effectiveStats = effectivePowerStatsForProgress(ctx, progress);
    candidates.push({
      identity: progress.identity,
      identityKey: progress.identity.toHexString(),
      displayName: profile.displayName,
      prestige: prestigeLevel,
      power: powerForProgress(effectiveStats),
      profileIcon: profile.profileIcon,
      gender: profile.gender,
      ...leaderboardAppearanceForProgress(ctx, progress, profile),
      damage: effectiveStats.damage,
      maxHp: effectiveStats.maxHp,
      armor: effectiveStats.armor,
      regen: effectiveStats.regen,
      playedMicros: (lifetime?.playedMicros ?? 0n) + (activeMicros > 0n ? activeMicros : 0n),
      isGuest: ctx.db.playerAccountStatus.identity.find(progress.identity)?.isGuest ?? current?.isGuest ?? false,
    });
  }

  writeLeaderboardPages(ctx, candidates);
  const selected = new Map(candidates.map(candidate => [candidate.identityKey, candidate]));
  for (const current of [...ctx.db.leaderboardEntry.iter()] as any[]) {
    if (!selected.has(current.identity.toHexString())) ctx.db.leaderboardEntry.identity.delete(current.identity);
  }
  for (const candidate of selected.values()) {
    const next = {
      identity: candidate.identity,
      displayName: candidate.displayName,
      power: legacyU32Power(candidate.power),
      powerLevel: candidate.power,
      profileIcon: candidate.profileIcon,
      gender: candidate.gender,
      skinTone: candidate.skinTone,
      headItem: candidate.headItem,
      chestItem: candidate.chestItem,
      feetItem: candidate.feetItem,
      rightHandItem: candidate.rightHandItem,
      leftHandItem: candidate.leftHandItem,
      damage: candidate.damage,
      maxHp: candidate.maxHp,
      armor: candidate.armor,
      regen: candidate.regen,
      playedMicros: candidate.playedMicros,
      isGuest: candidate.isGuest,
    };
    const current = ctx.db.leaderboardEntry.identity.find(candidate.identity);
    if (!current) ctx.db.leaderboardEntry.insert(next);
    else if (
      current.displayName !== next.displayName ||
      current.power !== next.power ||
      current.powerLevel !== next.powerLevel ||
      current.profileIcon !== next.profileIcon ||
      current.gender !== next.gender ||
      current.skinTone !== next.skinTone ||
      current.headItem !== next.headItem ||
      current.chestItem !== next.chestItem ||
      current.feetItem !== next.feetItem ||
      current.rightHandItem !== next.rightHandItem ||
      current.leftHandItem !== next.leftHandItem ||
      current.damage !== next.damage ||
      current.maxHp !== next.maxHp ||
      current.armor !== next.armor ||
      current.regen !== next.regen ||
      current.playedMicros !== next.playedMicros ||
      current.isGuest !== next.isGuest
    ) ctx.db.leaderboardEntry.identity.update(next);
  }

  const refreshState = ctx.db.leaderboardRefreshState.id.find(1);
  const nextState = { id: 1, refreshedAtMicros: ctx.timestamp.microsSinceUnixEpoch, version: LEADERBOARD_REFRESH_VERSION };
  if (refreshState) ctx.db.leaderboardRefreshState.id.update(nextState);
  else ctx.db.leaderboardRefreshState.insert(nextState);
}

/**
 * Rebuild for a player's own action (reset, respec, prestige, login move).
 * A rebuild walks every player, so at most one runs per minute: a second
 * request inside that minute only marks the board stale, and the per-minute
 * maintenance pass rebuilds it. Otherwise a script looping a free reset
 * could make the server rank everyone on every call.
 */
export function requestLeaderboardRefresh(ctx: any) {
  const state = ctx.db.leaderboardRefreshState.id.find(1);
  if (state?.version === LEADERBOARD_REFRESH_QUEUED) return;
  if (
    state?.version === LEADERBOARD_REFRESH_VERSION &&
    ctx.timestamp.microsSinceUnixEpoch - state.refreshedAtMicros < LEADERBOARD_PLAYER_REFRESH_MIN_MICROS
  ) {
    ctx.db.leaderboardRefreshState.id.update({ ...state, version: LEADERBOARD_REFRESH_QUEUED });
    return;
  }
  refreshLeaderboard(ctx);
}

export function refreshLeaderboardIfDue(ctx: any) {
  const state = ctx.db.leaderboardRefreshState.id.find(1);
  if (
    state?.version === LEADERBOARD_REFRESH_VERSION &&
    ctx.timestamp.microsSinceUnixEpoch - state.refreshedAtMicros < LEADERBOARD_REFRESH_INTERVAL_MICROS
  ) return;
  refreshLeaderboard(ctx);
}
