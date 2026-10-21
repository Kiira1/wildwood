// The Server Boost's tables and the multiplier kill reports read (server-boost.ts starts it).
// Kept apart from the trigger so the reward path imports no chat code.
import { table, t } from "spacetimedb/server";
import { serverBoostMultiplier, SERVER_BOOST_REPORT_GRACE_MS } from "../../shared/server-boost";

export const serverBoostTables = {
  /** One row (id 0), read by every client for the HUD timer and their own reward prediction. */
  serverBoost: table({ name: "server_boost", public: true }, {
    id: t.u8().primaryKey(), endsAtMs: t.f64(), supporterName: t.string(), startedAtMs: t.f64(),
  }),
  /** When each account last started one; read through my_server_boost_trigger. */
  serverBoostTrigger: table({ name: "server_boost_trigger", public: false }, {
    identity: t.identity().primaryKey(), lastTriggeredAtMs: t.f64(),
  }),
};

type Ctx = any;
const nowMs = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);

/** What a kill report's stat rewards and gold are multiplied by now. Offline progress never reads it. */
export function serverBoostRewardMultiplier(ctx: Ctx) {
  return serverBoostMultiplier(ctx.db.serverBoost.id.find(0)?.endsAtMs, nowMs(ctx), SERVER_BOOST_REPORT_GRACE_MS);
}
