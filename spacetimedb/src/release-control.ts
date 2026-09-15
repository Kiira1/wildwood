import { SenderError, table, t } from "spacetimedb/server";
import { parseReleaseWindow, RELEASE_LEASE_MS, type ReleasePhase } from "../../shared/release-window";

export const releaseNotice = table({ name: "release_notice", public: true }, {
  id: t.u32().primaryKey(), releaseJson: t.string(),
});

export const releaseAcknowledgement = table({ name: "release_acknowledgement", public: false }, {
  identity: t.identity().primaryKey(), releaseId: t.string(), acknowledgedAt: t.timestamp(),
});

type Context = {
  timestamp: { microsSinceUnixEpoch: bigint };
  db: { releaseNotice: { insert(row: any): void; id: { find(id: number): any; update(row: any): void } }; releaseAcknowledgement: any };
  sender: any;
};

export function writeReleaseWindow(ctx: Context, args: {
  id: string; version: string; phase: string; startsAt: number; reload: boolean;
}) {
  const now = Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
  const status = ctx.db.releaseNotice.id.find(0);
  const previous = parseReleaseWindow(status?.releaseJson);
  const phase = args.phase as ReleasePhase;
  const same = previous?.id === args.id;
  if (phase === "scheduled") {
    if (same) throw new SenderError("Use a new release id.");
    if (previous && !["complete", "cancelled"].includes(previous.phase) && previous.expiresAt > now) throw new SenderError("An update is already scheduled.");
    if (args.startsAt < now + 30_000 || args.startsAt > now + 86_400_000) throw new SenderError("Choose an update time 30 seconds to 24 hours ahead.");
  } else {
    if (!same || !previous || previous.expiresAt <= now) throw new SenderError("Update expired or changed. Schedule it again.");
    if (args.version !== previous.version || args.startsAt !== previous.startsAt || args.reload !== previous.reload) throw new SenderError("Update details changed.");
    const transitions: Record<ReleasePhase, ReleasePhase[]> = {
      scheduled: ["draining", "cancelled"], draining: ["draining", "updating", "cancelled"],
      updating: ["updating", "complete", "cancelled"], complete: [], cancelled: [],
    };
    if (!transitions[previous.phase].includes(phase)) throw new SenderError("Invalid update transition.");
    if (phase === "draining" && now < args.startsAt) throw new SenderError("Countdown has not finished.");
  }
  const next = { ...args, phase, updatedAt: now,
    expiresAt: phase === "scheduled" ? args.startsAt + RELEASE_LEASE_MS : now + RELEASE_LEASE_MS };
  if (!parseReleaseWindow(next)) throw new SenderError("Invalid update details.");
  const row = { id: 0, releaseJson: JSON.stringify(next) };
  if (status) ctx.db.releaseNotice.id.update(row);
  else ctx.db.releaseNotice.insert(row);
}

export function acknowledgeReleaseWindow(ctx: Context, id: string) {
  const now = Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
  const release = parseReleaseWindow(ctx.db.releaseNotice.id.find(0)?.releaseJson);
  if (!release || release.id !== id || release.phase !== "draining" || release.expiresAt <= now) throw new SenderError("Update is no longer preparing.");
  const current = ctx.db.releaseAcknowledgement.identity.find(ctx.sender);
  if (current?.releaseId === id) return;
  const row = { identity: ctx.sender, releaseId: id, acknowledgedAt: ctx.timestamp };
  if (current) ctx.db.releaseAcknowledgement.identity.update(row);
  else ctx.db.releaseAcknowledgement.insert(row);
}
