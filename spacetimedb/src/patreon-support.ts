import { SenderError } from "spacetimedb/server";
import type { ModuleReducerCtx } from "./index";
import { PROTOCOL_VERSION } from "../../shared/rules";

const PREFIX = "PATREON SUPPORT\n";
/** Email is a private lookup hint, never evidence that grants an entitlement. */
export function requestPatreonSupport(ctx: ModuleReducerCtx, email: string) {
  const normalized = email.trim();
  if (normalized.length > 254 || !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(normalized)) throw new SenderError("Enter your Patreon email address.");
  const profile = ctx.db.playerProfile.identity.find(ctx.sender);
  if (!profile) throw new SenderError("Enter the game first.");
  // Reuse the private developer inbox and keep one outstanding request per
  // character. The server supplies the identity and current name, not the form.
  const existing = [...ctx.db.bugReport.byReporter.filter(ctx.sender)].find(row => row.message.startsWith(PREFIX));
  if (existing && ctx.timestamp.microsSinceUnixEpoch - existing.reportedAt.microsSinceUnixEpoch < 60_000_000n) throw new SenderError("Your request was received. Wait a minute before updating it.");
  const row = { id: existing?.id ?? 0n, reporter: ctx.sender, reporterName: profile.displayName,
    message: `${PREFIX}Patreon email: ${normalized}\nVerify membership and ownership before applying a frame.`,
    protocolVersion: PROTOCOL_VERSION, reportedAt: ctx.timestamp };
  if (existing) ctx.db.bugReport.id.update(row); else ctx.db.bugReport.insert(row);
}
