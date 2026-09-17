import { SenderError, table, t } from "spacetimedb/server";
import type { GameReducerContext } from "./index";
import { MULTIPLAYER_TOGGLE_COOLDOWN_MS } from "../../shared/multiplayer";

export const playerMultiplayerPreference = table({ name: "player_multiplayer_preference" }, {
  identity: t.identity().primaryKey(), enabled: t.bool(), lastEnabledAtMicros: t.u64(),
});

/** Rate-limit enabling; hiding never waits on a cooldown. */
export function writeMultiplayerPreference(ctx: GameReducerContext, enabled: boolean) {
  const previous = ctx.db.playerMultiplayerPreference.identity.find(ctx.sender);
  if (previous?.enabled === enabled) return;
  const now = ctx.timestamp.microsSinceUnixEpoch;
  if (enabled && previous && previous.lastEnabledAtMicros > 0n && now - previous.lastEnabledAtMicros < BigInt(MULTIPLAYER_TOGGLE_COOLDOWN_MS) * 1_000n) {
    throw new SenderError("Multiplayer toggle is cooling down.");
  }
  const row = { identity: ctx.sender, enabled, lastEnabledAtMicros: enabled ? now : previous?.lastEnabledAtMicros ?? 0n };
  if (previous) ctx.db.playerMultiplayerPreference.identity.update(row);
  else ctx.db.playerMultiplayerPreference.insert(row);
}
