import { table, t } from "spacetimedb/server";

// Old native clients can continue playing, but must never receive the expanded
// duel row layout. Visibility filters apply to both subscriptions and SQL.
// RLS join lookups must be public and indexed in SpacetimeDB. This table holds
// only already-public identity IDs and decoder format numbers, never secrets.
export const duelWireAccess = table({ public: true,
  indexes: [{ accessor: "byIdentity", algorithm: "btree", columns: ["identity"] as const }],
}, { key: t.string().primaryKey(), identity: t.identity(), combatVersion: t.u8().index("btree") });

export function syncDuelWireAccess(ctx: any, protocol: number) {
  const existing = [...ctx.db.duelWireAccess.byIdentity.filter(ctx.sender)] as any[];
  for (const row of existing) ctx.db.duelWireAccess.key.delete(row.key);
  if (protocol !== 105) return;
  for (const combatVersion of [0, 1, 2]) ctx.db.duelWireAccess.insert({
    key: `${ctx.sender.toHexString()}:${combatVersion}`, identity: ctx.sender, combatVersion,
  });
}

export const DUEL_WIRE_FILTER = "SELECT duel.* FROM duel JOIN duel_wire_access ON duel.combat_version = duel_wire_access.combat_version WHERE duel_wire_access.identity = :sender";
export const DUEL_REPLAY_WIRE_FILTER = "SELECT duel_replay.* FROM duel_replay JOIN duel_wire_access ON duel_replay.combat_version = duel_wire_access.combat_version WHERE duel_wire_access.identity = :sender";
