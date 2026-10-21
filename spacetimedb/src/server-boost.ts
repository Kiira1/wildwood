// Server Boost (shared/server-boost.ts): a Patreon supporter starts 2x kill
// stat rewards and gold for everyone online, once a day per account.
import { t, SenderError } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import { isDeveloperIdentity } from "../../shared/developer-identity";
import { extendedServerBoostEnd, formatServerBoostWait, serverBoostCooldownMs, SERVER_BOOST_DURATION_MS, SERVER_BOOST_MAX_REMAINING_MS,
  serverBoostRemainingMs } from "../../shared/server-boost";
import { serverBoostTables } from "./server-boost-tables";
import { patreonStatus } from "./patreon";
import { insertChatMessage } from "./chat-runtime";
import { requireControllingPlayer } from "./session-guards";

type Ctx = any;
const nowMs = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);

/** Patreon supporters (any tier) and developers. */
const maySupport = (ctx: Ctx, identity: Identity) => patreonStatus(ctx, identity).tier !== "none";

/** Starts the boost, or adds 15 minutes to the one running. */
export function triggerServerBoost(ctx: Ctx) {
  requireControllingPlayer(ctx);
  if (!maySupport(ctx, ctx.sender)) throw new SenderError("Server Boost is a Patreon supporter perk.");
  const now = nowMs(ctx), developer = isDeveloperIdentity(ctx.sender.toHexString());
  const trigger = ctx.db.serverBoostTrigger.identity.find(ctx.sender);
  const wait = developer ? 0 : serverBoostCooldownMs(trigger?.lastTriggeredAtMs, now);
  if (wait > 0) throw new SenderError(`Your next Server Boost is ready in ${formatServerBoostWait(wait)}.`);
  const current = ctx.db.serverBoost.id.find(0);
  const endsAtMs = extendedServerBoostEnd(current?.endsAtMs, now);
  if (endsAtMs === null) {
    const roomIn = serverBoostRemainingMs(current?.endsAtMs ?? 0, now) + SERVER_BOOST_DURATION_MS - SERVER_BOOST_MAX_REMAINING_MS;
    throw new SenderError(`The Server Boost is full. Try again in ${formatServerBoostWait(roomIn)}.`);
  }
  const profile = ctx.db.playerProfile.identity.find(ctx.sender);
  const name = profile?.displayName || "A supporter";
  const extending = Boolean(current && current.endsAtMs > now);
  const row = { id: 0, endsAtMs, supporterName: name, startedAtMs: extending ? current.startedAtMs : now };
  if (current) ctx.db.serverBoost.id.update(row); else ctx.db.serverBoost.insert(row);
  const stamp = { identity: ctx.sender, lastTriggeredAtMs: now };
  if (trigger) ctx.db.serverBoostTrigger.identity.update(stamp); else ctx.db.serverBoostTrigger.insert(stamp);
  insertChatMessage(ctx, ctx.sender, name, extending
    ? "Added 15 minutes to the Server Boost: 2x Rewards for everyone online. Thank you for supporting WildStat! ♥"
    : "Started a Server Boost: 2x Rewards for everyone online for 15 minutes. Thank you for supporting WildStat! ♥");
}

/** The caller's own cooldown row, for the Shop. */
export function registerServerBoost(spacetimedb: any) {
  const myServerBoostTrigger = spacetimedb.view({ name: "my_server_boost_trigger", public: true },
    t.array(serverBoostTables.serverBoostTrigger.rowType),
    (ctx: any) => { const row = ctx.db.serverBoostTrigger.identity.find(ctx.sender); return row ? [row] : []; });
  return { myServerBoostTrigger };
}
