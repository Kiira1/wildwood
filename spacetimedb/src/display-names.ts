// Display names: generated guest names, the allowed-name check, the profile,
// presence and leaderboard rows a name appears on, moderation repair, and the
// paid name change. Moved out of index.ts unchanged.
import type { ModuleReducerCtx } from "./index";
import { NAME_ADJECTIVES, NAME_CREATURES } from "../../shared/rules";
import { isPublicDisplayNameAllowed, displayNameModerationReason, MODERATION_RULE_VERSION } from "./chat-moderation";
import { SenderError } from "spacetimedb/server";
import { syncDisplayNameHistory } from "./display-name-history";
import { withDuelWide } from "./wide-stats";
import { updateSnapshotRow, insertSnapshotRow } from "./snapshot-row-writes";
import { recordModerationAction } from "./moderation-history";
import { requireControllingPlayer, sameIdentity, touchPlayerAccessAudit } from "./session-guards";
import { nameChangeStatus } from "../../shared/name-change";
import { applyGemBalanceChange } from "./gem-wallet";
import { PLAYER_SKIN_TONES } from "../../shared/player-skin-tones";
import { PLAYER_GENDER_UNSET } from "../../shared/player-gender";
import { syncPlayerMotionIdentity } from "./presence-runtime";

export function generatedDisplayName(identity: { toHexString: () => string }) {
  let hash = 2166136261;
  for (const character of identity.toHexString()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const adjective = NAME_ADJECTIVES[(hash >>> 0) % NAME_ADJECTIVES.length];
  const creature = NAME_CREATURES[((hash >>> 8) >>> 0) % NAME_CREATURES.length];
  const number = String((hash >>> 16) % 1000).padStart(3, "0");
  return `${adjective} ${creature} ${number}`;
}

export function isGeneratedDisplayName(displayName: string) {
  const [adjective, creature, suffix, ...extra] = displayName.split(" ");
  return extra.length === 0 &&
    NAME_ADJECTIVES.includes(adjective) &&
    NAME_CREATURES.includes(creature) &&
    /^\d{3}$/.test(suffix ?? "");
}

export function requireAllowedDisplayName(displayName: string) {
  if (!isPublicDisplayNameAllowed(displayName)) {
    throw new SenderError("Display name is not allowed.");
  }
}

export function syncDisplayNamePresentation(ctx: any, identity: any, displayName: string) {
  const guildMember = ctx.db.guildMember.identity.find(identity);
  if (guildMember && guildMember.name !== displayName) {
    ctx.db.guildMember.identity.update({ ...guildMember, name: displayName });
  }
  const leaderboard = ctx.db.leaderboardEntry.identity.find(identity);
  if (leaderboard && leaderboard.displayName !== displayName) {
    ctx.db.leaderboardEntry.identity.update({ ...leaderboard, displayName });
  }
  const motionIdentity = ctx.db.playerMotionIdentity.identity.find(identity);
  if (motionIdentity && motionIdentity.displayName !== displayName) {
    ctx.db.playerMotionIdentity.networkId.update({ ...motionIdentity, displayName });
  }
  const audit = ctx.db.playerAccessAudit.identity.find(identity);
  if (audit && audit.displayName !== displayName) {
    ctx.db.playerAccessAudit.identity.update({ ...audit, displayName });
  }
  syncDisplayNameHistory(ctx, identity, displayName);
  for (const duel of [...ctx.db.duel.byChallenger.filter(identity)].map(row => withDuelWide(ctx, row)) as any[]) {
    if (duel.challengerName !== displayName) updateSnapshotRow(ctx, "duel", { ...duel, challengerName: displayName });
  }
  for (const duel of [...ctx.db.duel.byOpponent.filter(identity)].map(row => withDuelWide(ctx, row)) as any[]) {
    if (duel.opponentName !== displayName) updateSnapshotRow(ctx, "duel", { ...duel, opponentName: displayName });
  }
}

/** `forcedReason` renames even an allowed name: the developer's reset, with its reason. */
export function repairModeratedDisplayName(ctx: any, profile: any, actorType: "automatic" | "owner" | "developer" = "automatic", forcedReason = "") {
  if (!forcedReason && isPublicDisplayNameAllowed(profile.displayName)) return profile;
  const displayName = generatedDisplayName(profile.identity);
  const repaired = { ...profile, displayName };
  updateSnapshotRow(ctx, "playerProfile", repaired);
  // A forced safety rename must allow a free, immediate choice of a new valid name.
  if (ctx.db.playerNameCooldown.identity.find(profile.identity)) {
    ctx.db.playerNameCooldown.identity.delete(profile.identity);
  }
  syncDisplayNamePresentation(ctx, profile.identity, displayName);
  recordModerationAction(ctx, { targetIdentity: profile.identity.toHexString(), targetName: displayName,
    channel: "profile", action: "Name changed", reason: forcedReason || (displayNameModerationReason(profile.displayName) ?? "Disallowed username"),
    actorType, rule: MODERATION_RULE_VERSION, before: profile.displayName, after: displayName });
  return repaired;
}

export function changePlayerDisplayName(ctx: ModuleReducerCtx, displayName: string, expectedCost: number) {
  const activePlayer = requireControllingPlayer(ctx);
  const normalized = displayName.trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9 _-]{2,20}$/.test(normalized)) {
    throw new SenderError("Name must be 2-20 letters, numbers, spaces, hyphens, or underscores");
  }
  requireAllowedDisplayName(normalized);

  const existing = ctx.db.playerProfile.identity.find(ctx.sender);
  if (existing?.displayName === normalized) return;
  const cooldown = ctx.db.playerNameCooldown.identity.find(ctx.sender);
  const terms = nameChangeStatus(cooldown ? Number(cooldown.changedAt.microsSinceUnixEpoch / 1000n) : null,
    Number(ctx.timestamp.microsSinceUnixEpoch / 1000n), Number(ctx.db.playerGemWallet.identity.find(ctx.sender)?.balance ?? 0n));
  if (terms.availableAtMs > terms.serverNowMs) throw new SenderError("You can change your name once every 24 hours.");
  if (expectedCost !== terms.cost) throw new SenderError("Name changes cost 50 Gems after the first free change. Reopen the name editor to continue.");
  // Every profile is read here, so only after the cheap refusals: a call on cooldown never pays for it.
  const normalizedComparison = normalized.toLowerCase();
  for (const profile of ctx.db.playerProfile.iter() as Iterable<any>) {
    if (!sameIdentity(profile.identity, ctx.sender) && profile.displayName.toLowerCase() === normalizedComparison) {
      throw new SenderError("Player name is already taken.");
    }
  }
  if (terms.cost > 0) applyGemBalanceChange(ctx, { identity: ctx.sender, delta: -BigInt(terms.cost), kind: "name_change",
    note: "Player name change", externalReference: `name-change:${ctx.sender.toHexString()}:${ctx.timestamp.microsSinceUnixEpoch}` });

  if (existing) {
    updateSnapshotRow(ctx, "playerProfile", { ...existing, displayName: normalized });
  } else {
    insertSnapshotRow(ctx, "playerProfile", { identity: ctx.sender, displayName: normalized, profileIcon: 0, playerSprite: 0, skinTone: ctx.random.integerInRange(0, PLAYER_SKIN_TONES.length - 1), gender: PLAYER_GENDER_UNSET });
  }
  if (cooldown) ctx.db.playerNameCooldown.identity.update({ ...cooldown, changedAt: ctx.timestamp });
  else ctx.db.playerNameCooldown.insert({ identity: ctx.sender, changedAt: ctx.timestamp });
  syncDisplayNamePresentation(ctx, ctx.sender, normalized);
  syncPlayerMotionIdentity(ctx, activePlayer);
  touchPlayerAccessAudit(ctx, activePlayer.protocolVersion);
}
