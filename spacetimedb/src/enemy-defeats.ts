import { personalBossDefinition } from "../../shared/personal-bosses";
import { SenderError, table, t } from "spacetimedb/server";
import { defeatBudget, enemyDefeatDefinition, ENEMY_DEFEAT_BATCH_MAX, type EnemyDefeat } from "../../shared/enemy-defeats";

export const enemyDefeatBudget = table({ name: "enemy_defeat_budget" }, {
  key: t.string().primaryKey(), identity: t.identity().index("btree"), tokens: t.f64(), updatedAtMicros: t.u64(),
});
/** O(distinct species), independent of account count; one receipt per batch. */
export function acceptEnemyDefeats(ctx: any, batch: { streamId: string; sequence: bigint; mapId: string; enemies: EnemyDefeat[] }, activeMapId: string) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(batch.streamId) || batch.sequence < 1n || !batch.enemies.length || batch.enemies.length > ENEMY_DEFEAT_BATCH_MAX)
    throw new SenderError("Invalid enemy defeat batch.");
  const key = `${ctx.sender.toHexString()}:${batch.streamId}`;
  const prior = ctx.db.regularEnemyLootCursor.key.find(key);
  if (batch.sequence <= (prior?.sequence ?? 0n)) return null;
  if (batch.mapId !== activeMapId) throw new SenderError("Enemy defeats belong to another map.");
  if (batch.sequence !== (prior?.sequence ?? 0n) + 1n) throw new SenderError("Enemy defeat batches must arrive in order.");
  const seen = new Set<string>();
  let count = 0, lootCount = 0;
  const rewards = [];
  for (const entry of batch.enemies) {
    const definition = enemyDefeatDefinition(batch.mapId, entry.enemy);
    if (!definition || seen.has(entry.enemy) || !Number.isInteger(entry.count) || entry.count < 1 || (count += entry.count) > ENEMY_DEFEAT_BATCH_MAX)
      throw new SenderError("Invalid enemy for this map.");
    seen.add(entry.enemy);
    const boss = entry.enemy === "boss" ? personalBossDefinition(batch.mapId) : null;
    const budget = boss ? { capacity: 3, perSecond: 1 / boss.respawnSeconds } : defeatBudget(definition.population);
    const budgetKey = `${ctx.sender.toHexString()}:${batch.mapId}:${entry.enemy}`;
    const previous = ctx.db.enemyDefeatBudget.key.find(budgetKey);
    const now = ctx.timestamp.microsSinceUnixEpoch;
    const elapsed = previous ? Math.max(0, Number(now - previous.updatedAtMicros) / 1e6) : 0;
    const tokens = previous ? Math.min(budget.capacity, previous.tokens + elapsed * budget.perSecond) : budget.capacity;
    if (tokens + 1e-6 < entry.count) throw new SenderError("Enemy rewards are catching up. Retry shortly.");
    const next = { key: budgetKey, identity: ctx.sender, tokens: tokens - entry.count, updatedAtMicros: now };
    if (previous) ctx.db.enemyDefeatBudget.key.update(next); else ctx.db.enemyDefeatBudget.insert(next);
    rewards.push({ ...definition.reward, count: entry.count });
    if (definition.loot) lootCount += entry.count;
  }
  const receipt = { key, identity: ctx.sender, sequence: batch.sequence };
  if (prior) ctx.db.regularEnemyLootCursor.key.update(receipt); else ctx.db.regularEnemyLootCursor.insert(receipt);
  return { rewards, count, lootCount };
}
