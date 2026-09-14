import { table, t } from "spacetimedb/server";
import { Timestamp } from "spacetimedb";
import { CONNECTION_DIAGNOSTIC_BATCH_LIMIT, normalizeConnectionDiagnostic } from "../../shared/connection-diagnostics";

export const connectionDiagnosticTables = {
  connectionDiagnostic: table({ public: false, indexes: [{ accessor: "byIdentity", algorithm: "btree", columns: ["identity"] as const }] }, {
    id: t.string().primaryKey(), identity: t.identity(), playerName: t.string(), kind: t.string(),
    mapId: t.string(), clientVersion: t.string(), occurredAt: t.timestamp(), receivedAt: t.timestamp(), detailsJson: t.string(),
  }),
  connectionDiagnosticRate: table({ public: false }, {
    identity: t.identity().primaryKey(), startedAt: t.timestamp(), count: t.u32(),
  }),
};
const RETENTION = 7n * 86400n * 1_000_000n;
export function recordConnectionDiagnostics(ctx: any, payload: string) {
  if (payload.length > 24_000) return;
  let input: unknown;
  try { input = JSON.parse(payload); } catch { return; }
  if (!Array.isArray(input)) return;
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const previous = ctx.db.connectionDiagnosticRate.identity.find(ctx.sender);
  const rate = previous && now - previous.startedAt.microsSinceUnixEpoch < 60_000_000n
    ? { ...previous } : { identity: ctx.sender, startedAt: ctx.timestamp, count: 0 };
  for (const raw of input.slice(0, CONNECTION_DIAGNOSTIC_BATCH_LIMIT)) {
    if (rate.count >= 120) break;
    const sample = normalizeConnectionDiagnostic(raw);
    if (!sample) continue;
    const at = BigInt(sample.occurredAtMs) * 1000n;
    if (at < now - RETENTION || at > now + 300_000_000n) continue;
    const id = `${ctx.sender.toHexString()}:${sample.eventId}`;
    if (ctx.db.connectionDiagnostic.id.find(id)) continue;
    ctx.db.connectionDiagnostic.insert({ id, identity: ctx.sender,
      playerName: ctx.db.playerProfile.identity.find(ctx.sender)?.displayName ?? "Guest",
      kind: sample.kind, mapId: sample.mapId, clientVersion: sample.clientVersion,
      occurredAt: new Timestamp(at), receivedAt: ctx.timestamp, detailsJson: JSON.stringify(sample) });
    rate.count++;
  }
  if (previous) ctx.db.connectionDiagnosticRate.identity.update(rate);
  else ctx.db.connectionDiagnosticRate.insert(rate);
}
export function cleanupConnectionDiagnostics(ctx: any) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const retained: { id: string; receivedAt: Timestamp }[] = [];
  for (const row of ctx.db.connectionDiagnostic.iter()) {
    if (row.receivedAt.microsSinceUnixEpoch < now - RETENTION) ctx.db.connectionDiagnostic.id.delete(row.id);
    else retained.push(row);
  }
  retained.sort((a, b) => Number(a.receivedAt.microsSinceUnixEpoch - b.receivedAt.microsSinceUnixEpoch));
  for (const row of retained.slice(0, Math.max(0, retained.length - 50_000))) ctx.db.connectionDiagnostic.id.delete(row.id);
  for (const row of ctx.db.connectionDiagnosticRate.iter()) {
    if (now - row.startedAt.microsSinceUnixEpoch >= 60_000_000n) ctx.db.connectionDiagnosticRate.identity.delete(row.identity);
  }
}
