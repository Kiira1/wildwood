import { Timestamp } from "spacetimedb";
import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { enemyDefeatDefinition, defeatBudget } from "../../shared/enemy-defeats";
import { ENEMY_TYPES } from "../../shared/enemy-definitions";
import { rollRegularEnemyLoot } from "./regular-enemy-loot";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));
const enemy = Object.keys(ENEMY_TYPES).find(kind => enemyDefeatDefinition("water_reach", kind)?.reward.type === "damage")!;
const batch = { streamId: "test-stream-123456", sequence: 1n, mapId: "water_reach", enemies: [{ enemy, count: 20 }] };
it("awards Magma Armor for all seven winning outcomes, but not the next outcome", () => {
  const f = crystalFixture();
  for (let roll = 1; roll <= 8; roll++) {
    f.ctx.random.integerInRange = () => roll;
    const drops = rollRegularEnemyLoot(f.ctx as unknown as Parameters<typeof rollRegularEnemyLoot>[0], "advanced_lava_wastes", 1);
    expect(drops.get("magma_armor") ?? 0).toBe(roll <= 7 ? 1 : 0);
  }
});
function fixture() { const f = crystalFixture(); f.patch("player", { mapId: batch.mapId }); return f; }
it("calculates stats and independent loot rolls once in one transaction", () => {
  const f = fixture(), base = f.db.playerProgress.identity.find(f.ctx.sender);
  f.ctx.random.integerInRange = vi.fn(() => 1);
  const update = vi.spyOn(f.db.playerProgress.identity, "update");
  f.run(server.recordEnemyDefeats, { ...batch, progress: { damage: 1e30 } });
  expect(update).toHaveBeenCalledTimes(1);
  expect(f.db.playerProgress.identity.find(f.ctx.sender).damage).toBeCloseTo(base.damage + enemyDefeatDefinition(batch.mapId, enemy)!.reward.amount * 20);
  expect(f.db.playerLifetime.identity.find(f.ctx.sender).enemyKills).toBe(20n);
  expect(f.ctx.random.integerInRange).toHaveBeenCalledTimes(40);
  f.patch("player", { mapId: "home_exterior" });
  f.run(server.recordEnemyDefeats, batch);
  expect(update).toHaveBeenCalledTimes(1);
  expect(f.ctx.random.integerInRange).toHaveBeenCalledTimes(40);
});
it.each([
  { enemies: [{ enemy, count: 0 }] }, { enemies: [{ enemy, count: 101 }] }, { sequence: 2n },
  { enemies: [{ enemy: "Spitter", count: 1 }] }, { enemies: [{ enemy, count: 1 }, { enemy, count: 1 }] },
  { mapId: "cloudspire" },
])("rejects invalid identities/counts without consuming a receipt %s", change => {
  const f = fixture();
  expect(() => f.run(server.recordEnemyDefeats, { ...batch, ...change })).toThrow();
  expect([...f.db.regularEnemyLootCursor.iter()]).toHaveLength(0);
  expect([...f.db.enemyDefeatBudget.iter()]).toHaveLength(0);
});
it("rejects an unaccepted old-map report even when the map is unlocked", () => {
  const f = fixture(); f.patch("player", { mapId: "home_exterior" }); f.patch("playerProgress", { waterUnlocked: true });
  expect(() => f.run(server.recordEnemyDefeats, batch)).toThrow("another map");
});
it("rolls back reward, budget, receipt and loot if a write fails", () => {
  const f = fixture(), base = f.db.playerProgress.identity.find(f.ctx.sender);
  f.ctx.random.integerInRange = () => 1;
  const insert = vi.spyOn(f.db.playerItemDrop, "insert").mockImplementationOnce(() => { throw new Error("write failure"); });
  expect(() => f.run(server.recordEnemyDefeats, batch)).toThrow("write failure");
  expect([...f.db.regularEnemyLootCursor.iter()]).toHaveLength(0);
  expect([...f.db.enemyDefeatBudget.iter()]).toHaveLength(0);
  expect(f.db.playerProgress.identity.find(f.ctx.sender)).toEqual(base);
  insert.mockRestore(); f.run(server.recordEnemyDefeats, batch);
  expect([...f.db.playerItemDrop.iter()]).toHaveLength(2);
});
it("allows grouped kills and delayed batches; excessive claims only wait, even across new streams", () => {
  const f = fixture(); f.ctx.random.integerInRange = (_min: number, max: number) => max;
  const definition = enemyDefeatDefinition(batch.mapId, enemy)!;
  const capacity = Math.floor(defeatBudget(definition.population).capacity);
  let remaining = capacity, sequence = 1n;
  while (remaining) { const count = Math.min(100, remaining); f.run(server.recordEnemyDefeats, { ...batch, sequence: sequence++, enemies: [{ enemy, count }] }); remaining -= count; }
  const next = { ...batch, streamId: "another-stream-12345", enemies: [{ enemy, count: definition.population }] };
  expect(() => f.run(server.recordEnemyDefeats, next)).toThrow("catching up");
  // No temporary ban/session invalidation; waiting for one boosted respawn refills the budget.
  f.ctx.timestamp = new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + 4_000_000n);
  expect(() => f.run(server.recordEnemyDefeats, next)).not.toThrow();
});
it.each(["recordCombatCheckpoint", "recordRegularEnemyDefeats", "recordForestEnemyDefeat", "recordDesertEnemyDefeat", "recordSnowEnemyDefeat", "recordLavaEnemyDefeat"])("closes obsolete reward endpoint %s", reducer => {
  const f = fixture();
  expect(() => f.run((server as any)[reducer], { ...batch, count: 1, progress: { damage: 1e25 } })).toThrow("updated");
});
