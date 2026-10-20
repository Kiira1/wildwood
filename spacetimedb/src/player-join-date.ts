import { table, t } from "spacetimedb/server";
import type { Identity, Timestamp } from "spacetimedb";
import type { ModuleReducerCtx } from "./index";

// The join date copied out of player_lifetime, which every kill report
// rewrites. my_mailbox_v2 needs only this date, and a view re-runs whenever a
// table it read changes, so reading the lifetime row re-ran it on every kill.
export const playerJoinDate = table({ name: "player_join_date", public: false }, {
  identity: t.identity().primaryKey(), joinedAt: t.timestamp(),
});
export function syncPlayerJoinDate(ctx: ModuleReducerCtx, identity: Identity, joinedAt: Timestamp) {
  const current = ctx.db.playerJoinDate.identity.find(identity);
  if (current?.joinedAt.microsSinceUnixEpoch === joinedAt.microsSinceUnixEpoch) return;
  const next = { identity, joinedAt };
  if (current) ctx.db.playerJoinDate.identity.update(next); else ctx.db.playerJoinDate.insert(next);
}
export function removePlayerJoinDate(ctx: ModuleReducerCtx, identity: Identity) {
  if (ctx.db.playerJoinDate.identity.find(identity)) ctx.db.playerJoinDate.identity.delete(identity);
}
