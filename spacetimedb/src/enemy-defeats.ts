import { pinnedMapBalance } from "./map-balance";
import { personalBossDefinition } from "../../shared/personal-bosses";
import { SenderError, table, t } from "spacetimedb/server";
import { defeatBudget, enemyDefeatDefinition, ENEMY_DEFEAT_BATCH_MAX, type EnemyDefeat } from "../../shared/enemy-defeats";
import { bossDefeatLimits, BOSS_REWARD_WINDOW_SECONDS } from "./boss-defeat-limits";
import type { GameReducerContext } from "./index";

type BossRewardContext = Pick<GameReducerContext, "db" | "sender" | "timestamp">;

export const enemyDefeatBudget = table({ name: "enemy_defeat_budget" }, {
  key: t.string().primaryKey(), identity: t.identity().index("btree"), tokens: t.f64(), updatedAtMicros: t.u64(),
});
// Retained for non-destructive schema compatibility with previous releases.
// Reward validation now uses earned combat time, not a fixed defeat count.
export const bossDefeatWindow = table({ name: "boss_defeat_window" }, {
  identity: t.identity().primaryKey(), acceptedAtMicros: t.array(t.u64()),
});
// Historical per-map receipt timestamps; no longer read or written for limits.
export const bossMapDefeatWindow = table({ name: "boss_map_defeat_window" }, {
  identity: t.identity().primaryKey(), acceptedAtMicros: t.array(t.u64()), acceptedMapIds: t.array(t.string()),
});

const bossTimeKey = (identity: { toHexString(): string }, mapId: string) => `${identity.toHexString()}:${mapId}:boss-time-v1`;

/** Called only on account-world entry/travel; reconnecting never resets credit. */
export function beginBossTimeBudget(ctx: BossRewardContext, mapId: string) {
  const boss = personalBossDefinition(mapId);
  if (!boss) return;
  const key = bossTimeKey(ctx.sender, mapId);
  if (!ctx.db.enemyDefeatBudget.key.find(key)) ctx.db.enemyDefeatBudget.insert({
    key, identity: ctx.sender, tokens: boss.respawnSeconds, updatedAtMicros: ctx.timestamp.microsSinceUnixEpoch,
  });
}
/** O(distinct species), independent of account count; one receipt per batch. */
export function acceptEnemyDefeats(ctx: BossRewardContext, batch: { streamId: string; sequence: bigint; mapId: string; enemies: EnemyDefeat[] }, activeMapId: string,
  bossCombat: (earned: { type: string; amount: number; count: number }[]) => { dps: number; attackInterval: number }) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(batch.streamId) || batch.sequence < 1n || !batch.enemies.length)
    throw new SenderError("Invalid enemy defeat batch.");
  const key = `${ctx.sender.toHexString()}:${batch.streamId}`;
  const prior = ctx.db.regularEnemyLootCursor.key.find(key);
  if (batch.sequence <= (prior?.sequence ?? 0n)) return null;
  if (batch.mapId !== activeMapId) throw new SenderError("Enemy defeats belong to another map.");
  if (batch.sequence !== (prior?.sequence ?? 0n) + 1n) throw new SenderError("Enemy defeat batches must arrive in order.");
  const total = batch.enemies.reduce((sum, entry) => sum + entry.count, 0);
  if (batch.enemies.every(entry => Number.isInteger(entry.count) && entry.count > 0)
    && total > ENEMY_DEFEAT_BATCH_MAX) {
    const receipt = { key, identity: ctx.sender, sequence: batch.sequence };
    if (prior) ctx.db.regularEnemyLootCursor.key.update(receipt); else ctx.db.regularEnemyLootCursor.insert(receipt);
    return { rewards: [], count: 0, lootCount: 0, violations: [{ enemy: "batch", requested: total, accepted: 0 }] };
  }
  const balance = pinnedMapBalance(ctx, ctx.sender, batch.mapId);
  const seen = new Set<string>();
  let count = 0, lootCount = 0, submittedCount = 0;
  const rewards = [];
  const violations: { enemy: string; requested: number; accepted: number }[] = [];
  // A save can contain regular kills that already raised the client's DPS.
  // Validate those first, then include only their server-calculated rewards.
  const entries = batch.enemies.some(entry => entry.enemy === "boss")
    ? [...batch.enemies.filter(entry => entry.enemy !== "boss"), ...batch.enemies.filter(entry => entry.enemy === "boss")]
    : batch.enemies;
  for (const entry of entries) {
    const definition = enemyDefeatDefinition(batch.mapId, entry.enemy, balance ?? undefined);
    if (!definition || seen.has(entry.enemy) || !Number.isInteger(entry.count) || entry.count < 1 || (submittedCount += entry.count) > ENEMY_DEFEAT_BATCH_MAX)
      throw new SenderError("Invalid enemy for this map.");
    seen.add(entry.enemy);
    const boss = entry.enemy === "boss" ? balance?.boss ?? personalBossDefinition(batch.mapId) : null;
    const budget = boss ? { capacity: 1 + Math.ceil(300 / boss.respawnSeconds), perSecond: 1 / boss.respawnSeconds } : defeatBudget(definition.population, balance?.regularRespawnSeconds === undefined ? undefined : balance.regularRespawnSeconds / 6);
    const budgetKey = `${ctx.sender.toHexString()}:${batch.mapId}:${entry.enemy}`;
    const previous = ctx.db.enemyDefeatBudget.key.find(budgetKey);
    const now = ctx.timestamp.microsSinceUnixEpoch;
    const elapsed = previous ? Math.max(0, Number(now - previous.updatedAtMicros) / 1e6) : 0;
    const tokens = previous ? Math.min(budget.capacity, previous.tokens + elapsed * budget.perSecond) : budget.capacity;
    let acceptedCount = entry.count;
    if (boss) {
      const combat = bossCombat(rewards);
      const limits = bossDefeatLimits(boss.hp, combat.dps, combat.attackInterval, boss.respawnSeconds);
      const timeKey = bossTimeKey(ctx.sender, batch.mapId);
      const clock = ctx.db.enemyDefeatBudget.key.find(timeKey);
      // Existing online clients may have fought before this check was deployed.
      // Allow at most one ordinary save window, never a full slow-fight credit.
      const initialCredit = BOSS_REWARD_WINDOW_SECONDS + boss.respawnSeconds;
      const credit = limits ? Math.min(limits.capacitySeconds, clock
        ? clock.tokens + Math.max(0, Number(now - clock.updatedAtMicros) / 1e6) : initialCredit) : 0;
      // The earned-time budget already enforces HP / server DPS + respawn.
      // Receipt timestamps are not kill timestamps: counting them again in a
      // rolling per-map window rejects valid boundary kills and delayed saves.
      acceptedCount = limits ? Math.max(0, Math.min(entry.count, Math.floor(tokens + 1e-6),
        Math.floor(credit / limits.cycleSeconds + 1e-9))) : 0;
      if (acceptedCount < entry.count) console.warn("Boss defeat validation", JSON.stringify({
        identity: ctx.sender.toHexString(), mapId: batch.mapId, requested: entry.count, accepted: acceptedCount,
        hp: boss.hp, dps: combat.dps, attackInterval: combat.attackInterval, creditSeconds: credit,
        cycleSeconds: limits?.cycleSeconds ?? null,
      }));
      const nextClock = { key: timeKey, identity: ctx.sender,
        tokens: Math.max(0, credit - acceptedCount * (limits?.cycleSeconds ?? 0)), updatedAtMicros: now };
      if (clock) ctx.db.enemyDefeatBudget.key.update(nextClock); else ctx.db.enemyDefeatBudget.insert(nextClock);
      // Excess claims are consumed without rewards. Never leave an impossible
      // sealed report blocking saves, portals, or the valid kills behind it.
      if (acceptedCount < entry.count) violations.push({ enemy: entry.enemy, requested: entry.count, accepted: acceptedCount });
      if (!acceptedCount) continue;
    } else {
      // A sealed batch must be consumable even when it exceeds the maximum
      // bucket (one Endless spawn holds 91 kills; a report can contain 100).
      // Award only the server-earned allowance, then acknowledge the report so
      // it cannot permanently block saving or travel. Retrying a new stream
      // cannot restore the spent allowance.
      acceptedCount = Math.max(0, Math.min(entry.count, Math.floor(tokens + 1e-6)));
      if (acceptedCount < entry.count) console.warn("Enemy defeat validation", JSON.stringify({
        identity: ctx.sender.toHexString(), mapId: batch.mapId, enemy: entry.enemy,
        requested: entry.count, accepted: acceptedCount, capacity: budget.capacity,
      }));
      if (acceptedCount < entry.count) violations.push({ enemy: entry.enemy, requested: entry.count, accepted: acceptedCount });
      if (!acceptedCount) continue;
    }
    const next = { key: budgetKey, identity: ctx.sender, tokens: Math.max(0, tokens - acceptedCount), updatedAtMicros: now };
    if (previous) ctx.db.enemyDefeatBudget.key.update(next); else ctx.db.enemyDefeatBudget.insert(next);
    count += acceptedCount;
    rewards.push({ ...definition.reward, count: acceptedCount });
    if (definition.loot) lootCount += acceptedCount;
  }
  const receipt = { key, identity: ctx.sender, sequence: batch.sequence };
  if (prior) ctx.db.regularEnemyLootCursor.key.update(receipt); else ctx.db.regularEnemyLootCursor.insert(receipt);
  return { rewards, count, lootCount, violations };
}
