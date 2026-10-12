// Item upgrade timers: the scheduled completion row per bench slot, finishing,
// cancelling and reconciling an active upgrade, and removing a player's upgrade
// data. Moved out of index.ts unchanged; the upgrade reducers stay there.
import { normalizeUpgradeBenchSlot, deleteActiveItemUpgrade, rebaseActiveItemUpgradeTimer } from "./upgrade-bench-slots";
import { removeEquipmentOffers, removeEquipmentCopies } from "./equipment-copies";
import { deleteSnapshotRow, updateSnapshotRow, insertSnapshotRow } from "./snapshot-row-writes";
import { ScheduleAt } from "spacetimedb";
import { slotUpgradeTierFor, slotUpgradeKey, defaultPlayerProgress, restoreItemToProgress } from "./progress-helpers";
import { MAX_SLOT_UPGRADE_TIER } from "../../shared/items";
import { readPlayerProgress } from "./wide-stats";
import { isUpgradeSlot, upgradeSlotForItem } from "../../shared/slot-upgrades";
import { writeProgressAndPresentation } from "./player-power";

export function removeItemUpgradeCompletionSchedules(ctx: any, identity: any, slot?: number) {
  const scheduledIds = [...ctx.db.itemUpgradeCompletionSchedule.identity.filter(identity) as Iterable<any>]
    .filter((scheduled: any) => slot === undefined || normalizeUpgradeBenchSlot(scheduled.slot) === slot)
    .map((scheduled: any) => scheduled.scheduledId);
  for (const scheduledId of scheduledIds) ctx.db.itemUpgradeCompletionSchedule.scheduledId.delete(scheduledId);
}

export function removePlayerItemDrops(ctx: any, identity: any, keepCopies = false) {
  for (const drop of [...ctx.db.playerItemDrop.byIdentity.filter(identity) as Iterable<any>]) {
    ctx.db.playerItemDrop.key.delete(drop.key);
  }
  if (keepCopies) removeEquipmentOffers(ctx, identity); // Prestige keeps the bag, kept copies included.
  else removeEquipmentCopies(ctx, identity); // Kept copies and waiting offers are gear too.
}

export function removePlayerItemUpgradeData(ctx: any, identity: any, removeDrops = false) {
  if (ctx.db.activeItemUpgrade.identity.find(identity)) ctx.db.activeItemUpgrade.identity.delete(identity);
  if (ctx.db.activeItemUpgradeSlotTwo.identity.find(identity)) ctx.db.activeItemUpgradeSlotTwo.identity.delete(identity);
  if (ctx.db.activeItemUpgradeSlotThree.identity.find(identity)) ctx.db.activeItemUpgradeSlotThree.identity.delete(identity);
  removeItemUpgradeCompletionSchedules(ctx, identity);
  for (const upgrade of [...ctx.db.playerItemUpgrade.byIdentity.filter(identity) as Iterable<any>]) {
    deleteSnapshotRow(ctx, "playerItemUpgrade", upgrade.key);
  }
  if (removeDrops) removePlayerItemDrops(ctx, identity);
}

export function ensureItemUpgradeCompletionSchedule(ctx: any, active: any, slot: number) {
  const completesAtMicros = active.completesAt.microsSinceUnixEpoch;
  // The sweep calls this for every running upgrade; leave a correct schedule alone.
  const existing = [...ctx.db.itemUpgradeCompletionSchedule.identity.filter(active.identity) as Iterable<any>]
    .filter((scheduled: any) => normalizeUpgradeBenchSlot(scheduled.slot) === slot);
  if (!active.paused && existing.length === 1 && existing[0].itemId === active.itemId
    && existing[0].targetLevel === active.targetLevel && existing[0].completesAtMicros === completesAtMicros) return;
  removeItemUpgradeCompletionSchedules(ctx, active.identity, slot);
  if (active.paused) return;
  ctx.db.itemUpgradeCompletionSchedule.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(completesAtMicros),
    identity: active.identity,
    itemId: active.itemId,
    targetLevel: active.targetLevel,
    completesAtMicros,
    slot,
  });
}

export function completeActiveItemUpgrade(ctx: any, active: any, slot: number) {
  // The tier lands by itself the moment the schedule fires, online or not.
  // Nothing is returned to the bag, because nothing was taken from it.
  const currentLevel = slotUpgradeTierFor(ctx, active.identity, active.itemId);
  if (currentLevel === active.currentLevel && active.targetLevel === currentLevel + 1 && active.targetLevel <= MAX_SLOT_UPGRADE_TIER) {
    const key = slotUpgradeKey(active.identity, active.itemId);
    const current = ctx.db.playerItemUpgrade.key.find(key);
    const completed = { key, identity: active.identity, itemId: active.itemId, level: active.targetLevel };
    if (current) updateSnapshotRow(ctx, "playerItemUpgrade", completed);
    else insertSnapshotRow(ctx, "playerItemUpgrade", completed);
    const progress = readPlayerProgress(ctx, active.identity);
    if (progress) writeProgressAndPresentation(ctx, progress);
  }
  deleteActiveItemUpgrade(ctx, active.identity, slot);
  removeItemUpgradeCompletionSchedules(ctx, active.identity, slot);
}

export function cancelActiveItemUpgrade(ctx: any, active: any, slot: number) {
  // A slot upgrade takes nothing from the bag, so there is nothing to hand
  // back. A row left over from when upgrades belonged to items still names an
  // item, and that one is still returned.
  if (!isUpgradeSlot(active.itemId)) {
    const progress = readPlayerProgress(ctx, active.identity) ?? defaultPlayerProgress(active.identity);
    writeProgressAndPresentation(ctx, restoreItemToProgress(progress, active.itemId));
  }
  deleteActiveItemUpgrade(ctx, active.identity, slot);
  removeItemUpgradeCompletionSchedules(ctx, active.identity, slot);
}

export function reconcileActiveItemUpgrade(ctx: any, active: any, slot: number) {
  // itemId holds the slot now. Checking it with isUpgradeableItem answered
  // false for every running slot upgrade, so the next maintenance sweep,
  // sign-in or completion threw it away — which is why a slot never moved past
  // the tier the migration handed it.
  const upgradeSlot = isUpgradeSlot(active.itemId) ? active.itemId : upgradeSlotForItem(active.itemId);
  if (!upgradeSlot
    || active.currentLevel !== slotUpgradeTierFor(ctx, active.identity, upgradeSlot)
    || active.targetLevel !== active.currentLevel + 1) {
    cancelActiveItemUpgrade(ctx, active, slot);
    return;
  }
  if (active.paused) {
    cancelActiveItemUpgrade(ctx, active, slot);
    return;
  }
  const nextActive = rebaseActiveItemUpgradeTimer(ctx, active, slot);
  if (ctx.timestamp.microsSinceUnixEpoch >= nextActive.completesAt.microsSinceUnixEpoch) {
    completeActiveItemUpgrade(ctx, nextActive, slot);
    return;
  }
  ensureItemUpgradeCompletionSchedule(ctx, nextActive, slot);
}
