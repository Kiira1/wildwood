import { SenderError, table, t } from "spacetimedb/server";
import { SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
import { DEFEAT_COOLDOWN, DEFEAT_GUEST_BLOCK_SECONDS, DEFEAT_REAUTH, freshAuthentication } from "../../shared/defeat-session";
import { recordModerationAction } from "./moderation-history";
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
    return `${DEFEAT_COOLDOWN}:${row.blockedUntilMicros / 1000n}: Kill report exceeded the server allowance. Reconnect after 30 seconds.`;
  return null;
}

export function requireAllowedDefeatSession(ctx: GameReducerContext) {
  const error = defeatRestrictionError(ctx);
  if (error) throw new SenderError(error);
}

/** Commit this with the receipt, never throw afterward (that would undo it). */
export function restrictDefeatSession(ctx: GameReducerContext, evidence: unknown) {
  const jwt = ctx.senderAuth?.jwt;
  const requireSignIn = Boolean(jwt?.issuer === SPACETIME_AUTH_ISSUER && jwt.audience.includes(SPACETIME_AUTH_CLIENT_ID));
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const row = { identity: ctx.sender, revokedAtMicros: now, requireSignIn,
    blockedUntilMicros: requireSignIn ? 0n : now + BigInt(DEFEAT_GUEST_BLOCK_SECONDS) * 1_000_000n };
  if (ctx.db.defeatSessionRestriction.identity.find(ctx.sender)) ctx.db.defeatSessionRestriction.identity.update(row);
  else ctx.db.defeatSessionRestriction.insert(row);
  recordModerationAction(ctx, {
    targetIdentity: ctx.sender.toHexString(), targetName: ctx.db.playerProfile.identity.find(ctx.sender)?.displayName ?? "",
    channel: "game", action: requireSignIn ? "session_revoked" : "guest_connection_blocked",
    reason: "Enemy defeat claim exceeded server allowance", actorType: "automatic", rule: "enemy_defeat_allowance",
    before: JSON.stringify(evidence), after: JSON.stringify({ requireSignIn, blockedUntilMs: Number(row.blockedUntilMicros / 1000n) }),
  });
  // Invalidate every controlling session, including inactive tabs, immediately.
  for (const session of ctx.db.playerSession.byIdentity.filter(ctx.sender))
    ctx.db.playerSession.connectionId.update({ ...session, enteredWorld: false, protocolVersion: 0 });
  if (ctx.db.playerController.identity.find(ctx.sender)) ctx.db.playerController.identity.delete(ctx.sender);
}
