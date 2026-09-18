import { SenderError, table, t, type InferSchema, type ReducerCtx } from "spacetimedb/server";
import type schema from "./index";
import { regularMapLoot, REGULAR_ENEMY_LOOT_BATCH_MAX, type MapLootDrop } from "../../shared/regular-map-loot";

// One cursor per account/browser stream, rather than one receipt row per kill.
export const regularEnemyLootCursor = table({ name: "regular_enemy_loot_cursor" }, {
  key: t.string().primaryKey(), identity: t.identity().index("btree"), sequence: t.u64(),
});
type Context = ReducerCtx<InferSchema<typeof schema>>;
export function acceptRegularEnemyLootBatch(ctx: Context, batch: {
  streamId: string; sequence: bigint; mapId: string; count: number;
}, activeMapId: string, canReplayMap?: () => boolean) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(batch.streamId) || batch.sequence < 1n ||
      !Number.isInteger(batch.count) || batch.count < 1 || batch.count > REGULAR_ENEMY_LOOT_BATCH_MAX) {
    throw new SenderError("Invalid enemy loot batch.");
  }
  const key = `${ctx.sender.toHexString()}:${batch.streamId}`;
  const previous = ctx.db.regularEnemyLootCursor.key.find(key);
  // A lost acknowledgement can be retried after travel without rolling again.
  if (batch.sequence <= (previous?.sequence ?? 0n)) return false;
  if (batch.sequence !== (previous?.sequence ?? 0n) + 1n) throw new SenderError("Enemy loot batches must arrive in order.");
  if (!regularMapLoot(batch.mapId).length || (batch.mapId !== activeMapId && !canReplayMap?.())) throw new SenderError("Enemy loot belongs to another map.");
  const next = { key, identity: ctx.sender, sequence: batch.sequence };
  if (previous) ctx.db.regularEnemyLootCursor.key.update(next);
  else ctx.db.regularEnemyLootCursor.insert(next);
  return true;
}

/** Keep each item's independent per-kill roll; combine only the resulting writes. */
export function rollRegularEnemyLoot(ctx: Pick<Context, "random">, mapId: string, count: number, configuredLoot?: readonly MapLootDrop[]) {
  const rewards = new Map<string, number>();
  const loot = configuredLoot ?? regularMapLoot(mapId);
  for (let kill = 0; kill < count; kill++) {
    for (const drop of loot) {
      if (ctx.random.integerInRange(1, drop.outcomes) <= drop.wins) {
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
