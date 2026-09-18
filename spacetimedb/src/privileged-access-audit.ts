import { SenderError } from "spacetimedb/server";
import type { ModuleReducerCtx } from "./index";

/** Server logs survive a rejected transaction; database inserts would roll back.
 * Only failed access checks do these indexed reads. Never log request payloads,
 * credentials, or target records, which can contain private configuration.
 */
function recordRejectedAccess(ctx: ModuleReducerCtx, action: string, error: unknown) {
  console.warn("Privileged access denied", JSON.stringify({
    event: "privileged_access_denied",
    action,
    identity: ctx.sender.toHexString(),
    displayName: ctx.db.playerProfile.identity.find(ctx.sender)?.displayName ?? "",
    connectionId: ctx.connectionId?.toHexString() ?? null,
    atMicros: ctx.timestamp.microsSinceUnixEpoch.toString(),
    reason: error instanceof Error ? error.message : "Access check failed",
  }));
}

export function auditPrivilegedAccess(ctx: ModuleReducerCtx, action: string, authorize: () => void) {
  try { authorize(); }
  catch (error) {
    recordRejectedAccess(ctx, action, error);
    throw error;
  }
}

export function denyPrivilegedAccess(ctx: ModuleReducerCtx, action: string, reason: string): never {
  const error = new SenderError(reason);
  recordRejectedAccess(ctx, action, error);
  throw error;
}
