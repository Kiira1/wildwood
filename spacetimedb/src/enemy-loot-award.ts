import type { InferSchema, ReducerCtx } from "spacetimedb/server";
import type schema from "./index";
import { keepWantedDrops } from "./ignored-drops";
import { rollRegularEnemyLoot } from "./regular-enemy-loot";
import { readPlayerProgress } from "./wide-stats";
import { defaultPlayerProgress, inventoryForProgress, restoreItemToProgress } from "./progress-helpers";
import { activeItemUpgradeEntriesFor } from "./upgrade-bench-slots";
import { publishItemDrop } from "./equipment-copies";
import { insertSnapshotRow, updateSnapshotRow } from "./snapshot-row-writes";
import type { pinnedMapBalance } from "./map-balance";

type Context = ReducerCtx<InferSchema<typeof schema>>;

/**
 * The gear an accepted kill report drops: each item's own per-kill roll (regular-enemy-loot.ts), less what the
 * loot filter turns away. `balance` is the report's pinned map balance, already read and parsed by
 * acceptEnemyDefeats. With a `checkpoint` the new bag is returned for the caller to write with the rest of the
 * report; without one it is written here.
 */
export function awardRegularEnemyLoot(ctx: Context, mapId: string, count: number, balance: ReturnType<typeof pinnedMapBalance>, checkpoint?: { progress: any }) {
  const drops = keepWantedDrops(ctx, ctx.sender, rollRegularEnemyLoot(ctx, mapId, count, balance?.loot));
  if (!drops.size) return checkpoint?.progress;
  const current = checkpoint?.progress ?? readPlayerProgress(ctx, ctx.sender);
  let next = current ?? defaultPlayerProgress(ctx.sender);
  const owned = new Set(inventoryForProgress(next));
  for (const { active } of activeItemUpgradeEntriesFor(ctx, ctx.sender)) owned.add(active.itemId);
  let inventoryChanged = false;
  for (const [itemId, quantity] of drops) {
    const alreadyOwned = owned.has(itemId);
    publishItemDrop(ctx, ctx.sender, itemId, alreadyOwned, quantity);
    if (!alreadyOwned) {
      next = restoreItemToProgress(next, itemId);
      owned.add(itemId);
      inventoryChanged = true;
    }
  }
  if (!inventoryChanged || checkpoint) return next;
  if (current) updateSnapshotRow(ctx, "playerProgress", next);
  else insertSnapshotRow(ctx, "playerProgress", next);
  return next;
}
