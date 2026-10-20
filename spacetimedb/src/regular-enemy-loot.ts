import { Range, table, t, type InferSchema, type ReducerCtx } from "spacetimedb/server";
import type schema from "./index";
import { droppableLoot, regularMapLoot, type MapLootDrop } from "../../shared/regular-map-loot";

// One cursor per account/browser stream, rather than one receipt row per kill.
// Retired in 0.877 for regular_enemy_stream, which records when a stream was
// last used so idle ones can be dropped; a tab opened before then is still
// read from here once, and moved across on its next report.
export const regularEnemyLootCursor = table({ name: "regular_enemy_loot_cursor" }, {
  key: t.string().primaryKey(), identity: t.identity().index("btree"), sequence: t.u64(),
});
/**
 * The last report accepted on each account/browser stream, so a retry is
 * recognised and never paid twice. Every tab, and every discarded batch,
 * starts a new stream, so rows used to pile up for good.
 */
export const regularEnemyStream = table({ name: "regular_enemy_stream" }, {
  key: t.string().primaryKey(), identity: t.identity().index("btree"), sequence: t.u64(), updatedAtMicros: t.u64().index("btree"),
});
/**
 * A stream unused this long is dropped. Its tab would have to come back with
 * the same unacknowledged report a month later to notice; that report is then
 * refused as out of order, and the client discards it and starts a new stream.
 */
export const REGULAR_ENEMY_STREAM_IDLE_MICROS = 30n * 86_400_000_000n;
/**
 * Every live tab has written regular_enemy_stream within a month of 0.877
 * shipping, so the old cursor rows left after this are abandoned ones.
 */
export const LEGACY_LOOT_CURSOR_RETIRED_AT_MICROS = BigInt(Date.UTC(2026, 10, 4)) * 1000n;
const STREAM_PRUNE_BATCH = 2_000;
type Context = ReducerCtx<InferSchema<typeof schema>>;
type StreamContext = Pick<Context, "db" | "timestamp" | "sender">;

export type StreamCursor = { sequence: bigint; legacy: boolean } | null;
export function streamCursor(ctx: Pick<Context, "db">, key: string): StreamCursor {
  const row = ctx.db.regularEnemyStream.key.find(key);
  if (row) return { sequence: row.sequence, legacy: false };
  const legacy = ctx.db.regularEnemyLootCursor.key.find(key);
  return legacy ? { sequence: legacy.sequence, legacy: true } : null;
}
export function advanceStreamCursor(ctx: StreamContext, key: string, sequence: bigint, prior: StreamCursor) {
  const row = { key, identity: ctx.sender, sequence, updatedAtMicros: ctx.timestamp.microsSinceUnixEpoch };
  if (prior && !prior.legacy) ctx.db.regularEnemyStream.key.update(row);
  else ctx.db.regularEnemyStream.insert(row);
  if (prior?.legacy) ctx.db.regularEnemyLootCursor.key.delete(key);
}
export function removeStreamCursors(ctx: Pick<Context, "db">, identity: any) {
  for (const row of [...ctx.db.regularEnemyStream.identity.filter(identity)]) ctx.db.regularEnemyStream.key.delete(row.key);
  for (const row of [...ctx.db.regularEnemyLootCursor.identity.filter(identity)]) ctx.db.regularEnemyLootCursor.key.delete(row.key);
}
/** Drops idle streams oldest first, and once every live tab has moved over, the old cursors. Returns how many went. */
export function pruneIdleStreams(ctx: Pick<Context, "db" | "timestamp">) {
  const now = ctx.timestamp.microsSinceUnixEpoch, cutoff = now - REGULAR_ENEMY_STREAM_IDLE_MICROS;
  const idle: string[] = [];
  if (cutoff > 0n) for (const row of ctx.db.regularEnemyStream.updatedAtMicros.filter(new Range({ tag: "unbounded" }, { tag: "excluded", value: cutoff }))) {
    idle.push(row.key);
    if (idle.length === STREAM_PRUNE_BATCH) break;
  }
  for (const key of idle) ctx.db.regularEnemyStream.key.delete(key);
  const legacy: string[] = [];
  if (now >= LEGACY_LOOT_CURSOR_RETIRED_AT_MICROS) for (const row of ctx.db.regularEnemyLootCursor.iter()) {
    legacy.push(row.key);
    if (idle.length + legacy.length >= STREAM_PRUNE_BATCH) break;
  }
  for (const key of legacy) ctx.db.regularEnemyLootCursor.key.delete(key);
  return idle.length + legacy.length;
}

/**
 * Whether a drop of `wins` in `outcomes`, its chance multiplied, lands. The outcome the raised chance ends partway
 * into wins for that part: compared as whole rolls, 1 in 200 raised by half stayed 1 in 200.
 */
export function dropLands(ctx: Pick<Context, "random">, wins: number, outcomes: number, multiplier: number) {
  const threshold = Math.min(outcomes, wins * multiplier), whole = Math.floor(threshold), part = threshold - whole;
  const roll = ctx.random.integerInRange(1, outcomes);
  return roll <= whole || (part > 0 && roll === whole + 1 && ctx.random() < part);
}

/**
 * Keep each item's independent per-kill roll; combine only the resulting writes. A pinned list is screened, so
 * gear listed by a balance pinned before gear stopped dropping never drops.
 */
export function rollRegularEnemyLoot(ctx: Pick<Context, "random">, mapId: string, count: number, configuredLoot?: readonly MapLootDrop[]) {
  const rewards = new Map<string, number>();
  const loot = configuredLoot ? droppableLoot(configuredLoot) : regularMapLoot(mapId);
  if (!loot.length) return rewards;
  for (let kill = 0; kill < count; kill++) {
    for (const drop of loot) {
      if (dropLands(ctx, drop.wins, drop.outcomes, 1)) {
        rewards.set(drop.itemId, (rewards.get(drop.itemId) ?? 0) + 1);
      }
    }
  }
  return rewards;
}

const LOOT_MAP_UNLOCKS: Record<string, string> = {
  beginner_desert: "desertUnlocked", intermediate_snowlands: "snowlandsUnlocked",
  advanced_lava_wastes: "lavaUnlocked", infernal_depths: "infernalUnlocked",
  water_reach: "waterUnlocked", samurai_garden: "samuraiUnlocked",
  cloudspire: "cloudspireUnlocked", moonfen: "moonfenUnlocked",
  crystal_hollows: "crystalHollowsUnlocked", clockwork_ruins: "clockworkRuinsUnlocked",
  duskfall_orchard: "duskfallOrchardUnlocked", neon_bastion: "neonBastionUnlocked",
  verdant_catacombs: "verdantCatacombsUnlocked", ion_citadel: "ionCitadelUnlocked",
};
export function canReplayRegularEnemyLoot(mapId: string, progress: any) {
  return Boolean(progress && (mapId === "tutorial_forest" || progress[LOOT_MAP_UNLOCKS[mapId]] === true));
}
