// Virtual players (the load-test puppets) and maintenance scheduling: per-owner
// counts, clearing expired and orphaned runs and realtime rows, and the
// maintenance schedule rows. Moved out of index.ts unchanged.
import { ScheduleAt } from "spacetimedb";
import { adjustPlayerMotionMapState } from "./presence-runtime";
import { clearAutoFarmPuppet } from "./autofarm-puppet";

export const MAINTENANCE_INTERVAL_MICROS = 60_000_000n;

export const VIRTUAL_PLAYER_RUN_LIFETIME_MICROS = 3_600_000_000n;

export function adjustVirtualPlayerCount(ctx: any, owner: any, change: number) {
  const current = ctx.db.virtualPlayerLoad.owner.find(owner);
  const activeCount = Math.max(0, (current?.activeCount ?? 0) + change);
  if (activeCount === 0) {
    if (current) ctx.db.virtualPlayerLoad.owner.delete(owner);
    return;
  }
  const next = { owner, activeCount };
  if (current) ctx.db.virtualPlayerLoad.owner.update(next);
  else ctx.db.virtualPlayerLoad.insert(next);
}

export function virtualPlayerCountForOwner(ctx: any, owner: any) {
  const current = ctx.db.virtualPlayerLoad.owner.find(owner);
  if (current) return current.activeCount;

  // One indexed recount repairs deployments created before the counter table.
  // Every later authorization is a primary-key lookup plus one increment.
  let activeCount = 0;
  for (const _registration of ctx.db.virtualPlayer.byOwner.filter(owner) as Iterable<any>) activeCount += 1;
  if (activeCount > 0) ctx.db.virtualPlayerLoad.insert({ owner, activeCount });
  return activeCount;
}

export function clearExpiredVirtualPlayerRuns(ctx: any) {
  for (const run of [...ctx.db.virtualPlayerRun.iter()] as Iterable<any>) {
    const ownerActive = Boolean(
      ctx.db.player.identity.find(run.owner) &&
      ctx.db.playerController.identity.find(run.owner)
    );
    if (!ownerActive || ctx.timestamp.microsSinceUnixEpoch >= run.expiresAtMicros) {
      ctx.db.virtualPlayerRun.owner.delete(run.owner);
    }
  }
}

export function clearOrphanRealtimeState(ctx: any) {
  const orphanIdentities: any[] = [];
  for (const motion of ctx.db.playerMotion.iter() as Iterable<any>) {
    if (!ctx.db.player.identity.find(motion.identity)) orphanIdentities.push(motion.identity);
  }
  for (const identity of orphanIdentities) removePlayerRealtimeState(ctx, identity);

  const orphanNetworkIds: number[] = [];
  for (const mapping of ctx.db.playerMotionIdentity.iter() as Iterable<any>) {
    if (!ctx.db.playerMotion.identity.find(mapping.identity)) orphanNetworkIds.push(mapping.networkId);
  }
  for (const networkId of orphanNetworkIds) ctx.db.playerMotionIdentity.networkId.delete(networkId);
}

export function ensureMaintenanceSchedule(ctx: any) {
  for (const _task of ctx.db.maintenanceSchedule.iter()) return;
  ctx.db.maintenanceSchedule.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.interval(MAINTENANCE_INTERVAL_MICROS),
  });
}

export function ensureMaintenanceSweepSchedule(ctx: any) {
  for (const _task of ctx.db.maintenanceSweepSchedule.iter()) return;
  ctx.db.maintenanceSweepSchedule.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.interval(5n * MAINTENANCE_INTERVAL_MICROS),
  });
}

export function removePlayerRealtimeState(ctx: any, identity: any) {
  if (ctx.db.playerMotionInterest.identity.find(identity)) ctx.db.playerMotionInterest.identity.delete(identity);
  const motion = ctx.db.playerMotion.identity.find(identity);
  if (motion) {
    ctx.db.playerMotion.networkId.delete(motion.networkId);
    adjustPlayerMotionMapState(ctx, motion.mapId, -1, motion.isVisible ? -1 : 0);
  }
  const mapping = ctx.db.playerMotionIdentity.identity.find(identity);
  if (mapping) ctx.db.playerMotionIdentity.networkId.delete(mapping.networkId);
  clearAutoFarmPuppet(ctx, identity);
}
