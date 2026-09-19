import { SenderError, table, t } from "spacetimedb/server";
import { SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
import { DEFEAT_COOLDOWN, DEFEAT_GUEST_BLOCK_SECONDS, DEFEAT_REAUTH, freshAuthentication } from "../../shared/defeat-session";
import { recordModerationAction } from "./moderation-history";
import { updatePublicChatCursor } from "./public-chat-history";
import type { GameReducerContext } from "./index";

export const defeatSessionRestriction = table({ name: "defeat_session_restriction", public: false }, {
  identity: t.identity().primaryKey(), revokedAtMicros: t.u64(), blockedUntilMicros: t.u64(), requireSignIn: t.bool(),
});

export function defeatRestrictionError(ctx: Pick<GameReducerContext, "db" | "sender" | "senderAuth" | "timestamp">) {
  const row = ctx.db.defeatSessionRestriction.identity.find(ctx.sender);
  if (!row) return null;
  if (row.requireSignIn) {
    const jwt = ctx.senderAuth?.jwt;
    const authenticated = jwt?.issuer === SPACETIME_AUTH_ISSUER && jwt.audience.includes(SPACETIME_AUTH_CLIENT_ID);
    if (!authenticated || !freshAuthentication(jwt?.fullPayload?.auth_time, row.revokedAtMicros))
      return `${DEFEAT_REAUTH}: Kill report exceeded the server allowance. Sign in again.`;
  }
  if (ctx.timestamp.microsSinceUnixEpoch < row.blockedUntilMicros)
    return `${DEFEAT_COOLDOWN}:${row.blockedUntilMicros / 1000n}: Account access temporarily restricted.`;
  return null;
}

/** Owner-authorized fixed deadline: retrying the same action cannot extend it. */
export function suspendPlayerAccount(ctx: GameReducerContext, args: {
  identity: GameReducerContext['sender']; expectedDisplayName: string; untilMicros: bigint; reason: string;
}) {
  const profile = ctx.db.playerProfile.identity.find(args.identity);
  const now = ctx.timestamp.microsSinceUnixEpoch;
  if (!profile || profile.displayName !== args.expectedDisplayName) throw new SenderError("Suspension target changed or was not found.");
  if (args.untilMicros <= now || args.untilMicros > now + 7n * 86_400_000_000n || !args.reason.trim() || args.reason.length > 500)
    throw new SenderError("Choose a suspension of at most seven days and a reason.");
  const prior = ctx.db.defeatSessionRestriction.identity.find(args.identity);
  if (prior && prior.blockedUntilMicros >= args.untilMicros) return;
  const next = { identity: args.identity, revokedAtMicros: now, requireSignIn: false, blockedUntilMicros: args.untilMicros };
  if (prior) ctx.db.defeatSessionRestriction.identity.update(next); else ctx.db.defeatSessionRestriction.insert(next);
  for (const session of ctx.db.playerSession.byIdentity.filter(args.identity))
    ctx.db.playerSession.connectionId.update({ ...session, enteredWorld: false, protocolVersion: 0 });
  if (ctx.db.playerController.identity.find(args.identity)) ctx.db.playerController.identity.delete(args.identity);
  const json = (value: unknown) => JSON.stringify(value, (_key, value) => typeof value === "bigint" ? value.toString() : value);
  recordModerationAction(ctx, { targetIdentity: args.identity.toHexString(), targetName: profile.displayName,
    channel: "account", action: "Account suspended", reason: args.reason, actorType: "owner", rule: "owner-account-suspension",
    before: json(prior), after: json(next) });
}

export function requireAllowedDefeatSession(ctx: GameReducerContext) {
  const error = defeatRestrictionError(ctx);
  if (error) throw new SenderError(error);
}

/** Commit this with the receipt, never throw afterward (that would undo it). */
export function restrictDefeatSession(ctx: GameReducerContext, evidence: {
  mapId: string; streamId: string; sequence: string;
  violations: { enemy: string; requested: number; accepted: number }[];
}) {
  const jwt = ctx.senderAuth?.jwt;
  const requireSignIn = Boolean(jwt?.issuer === SPACETIME_AUTH_ISSUER && jwt.audience.includes(SPACETIME_AUTH_CLIENT_ID));
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const row = { identity: ctx.sender, revokedAtMicros: now, requireSignIn,
    blockedUntilMicros: requireSignIn ? 0n : now + BigInt(DEFEAT_GUEST_BLOCK_SECONDS) * 1_000_000n };
  if (ctx.db.defeatSessionRestriction.identity.find(ctx.sender)) ctx.db.defeatSessionRestriction.identity.update(row);
  else ctx.db.defeatSessionRestriction.insert(row);
  const identity = ctx.sender.toHexString();
  const displayName = ctx.db.playerProfile.identity.find(ctx.sender)?.displayName ?? "";
  const action = requireSignIn ? "session_revoked" : "guest_connection_blocked";
  const moderationId = recordModerationAction(ctx, {
    targetIdentity: identity, targetName: displayName,
    channel: "game", action,
    reason: "Enemy defeat claim exceeded server allowance", actorType: "automatic", rule: "enemy_defeat_allowance",
    before: JSON.stringify(evidence), after: JSON.stringify({ requireSignIn, blockedUntilMs: Number(row.blockedUntilMicros / 1000n) }),
  });
  // Invalidate every controlling session, including inactive tabs, immediately.
  for (const session of ctx.db.playerSession.byIdentity.filter(ctx.sender))
    ctx.db.playerSession.connectionId.update({ ...session, enteredWorld: false, protocolVersion: 0 });
  if (ctx.db.playerController.identity.find(ctx.sender)) ctx.db.playerController.identity.delete(ctx.sender);
  // The caller logs only after all reward/session cleanup has succeeded.
  // Link the readable diagnostic to the durable, transaction-backed evidence.
  return { event: "enemy_defeat_session_restricted", action, identity, displayName,
    connectionId: ctx.connectionId?.toHexString() ?? null, moderationId: moderationId.toString(),
    atMicros: now.toString(), requireSignIn, blockedUntilMs: Number(row.blockedUntilMicros / 1000n), ...evidence };
}

/**
 * Blocks a client that proves its local simulation is running ahead of the
 * server clock. This deliberately uses the existing session restriction row
 * so it invalidates every active tab without adding another migration-only
 * table. The deadline is fixed for this event and is never extended by a
 * retry from the same client.
 */
export function restrictSimulationSession(ctx: GameReducerContext, evidence: {
  kind: "movement_speed" | "movement_position";
  mapId: string;
  requestedSpeed?: number;
  serverSpeed?: number;
  distance?: number;
  maxDistance?: number;
  elapsedSeconds?: number;
}) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const blockedUntilMicros = now + 3_600_000_000n;
  const prior = ctx.db.defeatSessionRestriction.identity.find(ctx.sender);
  const next = {
    identity: ctx.sender,
    revokedAtMicros: now,
    // Preserve an existing re-authentication requirement from a separate
    // defeat violation, while this guard supplies the one-hour cooldown.
    requireSignIn: prior?.requireSignIn ?? false,
    blockedUntilMicros: (prior?.blockedUntilMicros ?? 0n) > blockedUntilMicros
      ? prior!.blockedUntilMicros
      : blockedUntilMicros,
  };
  if (prior) ctx.db.defeatSessionRestriction.identity.update(next);
  else ctx.db.defeatSessionRestriction.insert(next);
  for (const session of ctx.db.playerSession.byIdentity.filter(ctx.sender)) {
    ctx.db.playerSession.connectionId.update({ ...session, enteredWorld: false, protocolVersion: 0 });
  }
  if (ctx.db.playerController.identity.find(ctx.sender)) ctx.db.playerController.identity.delete(ctx.sender);
  const profile = ctx.db.playerProfile.identity.find(ctx.sender);
  const json = (value: unknown) => JSON.stringify(value, (_key, value) => typeof value === "bigint" ? value.toString() : value);
  const moderationId = recordModerationAction(ctx, {
    targetIdentity: ctx.sender.toHexString(), targetName: profile?.displayName ?? "",
    channel: "game", action: "simulation_session_blocked",
    reason: "Client simulation exceeded the server movement allowance", actorType: "automatic",
    rule: "simulation_speed_guard", before: json(evidence), after: json({ blockedUntilMs: Number(next.blockedUntilMicros / 1000n) }),
  });
  // Make the automatic action visible to players.  The message is inserted in
  // the same transaction as the restriction, so it can never announce a ban
  // that failed to commit.  Use a system sender label rather than pretending
  // the blocked client authored the announcement.
  const announcement = ctx.db.chatMessage.insert({
    id: 0n,
    sender: ctx.sender,
    senderName: "SERVER",
    senderIsGuest: false,
    message: `${profile?.displayName || "A player"} was blocked for a gamespeed exploit (1 hour).`,
    sentAt: ctx.timestamp,
    replayId: 0n,
    powerLevel: 0,
    senderGender: 0,
    moderated: false,
    replyToMessageId: 0n,
    replyToSenderName: "",
    replyToMessage: "",
    guildReplayKey: "",
  });
  updatePublicChatCursor(ctx, announcement.id);
  console.warn("Simulation session blocked", JSON.stringify({
    identity: ctx.sender.toHexString(), displayName: profile?.displayName ?? "", moderationId: moderationId.toString(),
    blockedUntilMs: Number(next.blockedUntilMicros / 1000n), ...evidence,
  }));
}
