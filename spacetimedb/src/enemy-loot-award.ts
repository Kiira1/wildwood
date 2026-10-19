import type { InferSchema, ReducerCtx } from "spacetimedb/server";
import type schema from "./index";
import { keepWantedDrops } from "./ignored-drops";
import { rollRegularEnemyLoot } from "./regular-enemy-loot";
import { readPlayerProgress } from "./wide-stats";
import { defaultPlayerProgress, inventoryForProgress, restoreItemToProgress } from "./progress-helpers";
import { activeItemUpgradeEntriesFor } from "./upgrade-bench-slots";
import { freeBagSlots, offerItemForFullBag, publishItemDrop } from "./equipment-copies";
import { isDuplicateOfferItem } from "../../shared/equipment-copies";
import { insertSnapshotRow, updateSnapshotRow } from "./snapshot-row-writes";
import type { pinnedMapBalance } from "./map-balance";

type Context = ReducerCtx<InferSchema<typeof schema>>;

/**
 * Items from an accepted kill report (no gear: that comes from the Smith), less what the loot filter drops. With
 * `checkpoint` the caller writes the bag.
 */
export function awardRegularEnemyLoot(ctx: Context, mapId: string, count: number, balance: ReturnType<typeof pinnedMapBalance>,
  checkpoint?: { progress: any }) {
  return awardDrops(ctx, keepWantedDrops(ctx, ctx.sender, rollRegularEnemyLoot(ctx, mapId, count, balance?.loot)), checkpoint);
}

/** Rolled drops into the bag: new items go in, or wait as offers when it is full, and owned ones are settled. */
export function awardDrops(ctx: Context, drops: ReadonlyMap<string, number>, checkpoint?: { progress: any }) {
  if (!drops.size) return checkpoint?.progress;
  const current = checkpoint?.progress ?? readPlayerProgress(ctx, ctx.sender);
  let next = current ?? defaultPlayerProgress(ctx.sender);
  const owned = new Set(inventoryForProgress(next));
  for (const { active } of activeItemUpgradeEntriesFor(ctx, ctx.sender)) owned.add(active.itemId);
  let inventoryChanged = false;
  let free: number | null = null;
  for (const [itemId, quantity] of drops) {
    const alreadyOwned = owned.has(itemId);
    if (!alreadyOwned && isDuplicateOfferItem(itemId)) {
      free ??= freeBagSlots(ctx, ctx.sender, next, inventoryForProgress(next));
      // A full bag never overfills: the new item waits as a Keep/Ignore offer instead.
      if (free <= 0) { offerItemForFullBag(ctx, ctx.sender, itemId, quantity); continue; }
      free -= 1;
    }
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
