import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));
const batch = { streamId: "test-stream-123456", sequence: 1n, mapId: "water_reach", count: 20 };
it("rolls each kill independently and writes inventory only once for a batch", () => {
  const f = crystalFixture(); f.patch("player", { mapId: batch.mapId });
  f.ctx.random.integerInRange = vi.fn(() => 1);
  const update = vi.spyOn(f.db.playerProgress.identity, "update");
  f.run(server.recordRegularEnemyDefeats, batch);
  expect(f.ctx.random.integerInRange).toHaveBeenCalledTimes(40);
  expect(update).toHaveBeenCalledTimes(1);
  expect([...f.db.playerItemDrop.iter()].map((r: any) => r.sequence)).toEqual([20n, 20n]);
  f.patch("player", { mapId: "home_exterior" });
  f.run(server.recordRegularEnemyDefeats, batch);
  expect(f.ctx.random.integerInRange).toHaveBeenCalledTimes(40);
});
it("records missed rolls so reconnect retries cannot reroll them", () => {
  const f = crystalFixture(); f.patch("player", { mapId: batch.mapId });
  f.ctx.random.integerInRange = vi.fn((_min, max) => max);
  f.run(server.recordRegularEnemyDefeats, batch);
  f.ctx.random.integerInRange = vi.fn(() => 1);
  f.run(server.recordRegularEnemyDefeats, batch);
  expect(f.ctx.random.integerInRange).not.toHaveBeenCalled();
  expect([...f.db.playerItemDrop.iter()]).toHaveLength(0);
});
it.each([{ count: 0 }, { count: 101 }, { sequence: 2n }, { mapId: "cloudspire" }])("rejects invalid/out-of-order batches %s", change => {
  const f = crystalFixture(); f.patch("player", { mapId: batch.mapId });
  f.ctx.random.integerInRange = vi.fn(() => 1);
  expect(() => f.run(server.recordRegularEnemyDefeats, { ...batch, ...change })).toThrow();
  expect(f.ctx.random.integerInRange).not.toHaveBeenCalled();
  expect([...f.db.regularEnemyLootCursor.iter()]).toHaveLength(0);
});

it("commits stats and loot together once, including a retry after travel", () => {
  const f = crystalFixture(); f.patch("player", { mapId: batch.mapId });
  const base = f.db.playerProgress.identity.find(f.ctx.sender);
  const progress = { ...base, damage: base.damage + 8, enemyKills: 20 };
  f.ctx.random.integerInRange = vi.fn(() => 1);
  const update = vi.spyOn(f.db.playerProgress.identity, "update");
  f.run(server.recordCombatCheckpoint, { ...batch, progress });
  expect(update).toHaveBeenCalledTimes(1);
  expect(f.db.playerProgress.identity.find(f.ctx.sender).damage).toBe(base.damage + 8);
  expect(f.db.playerLifetime.identity.find(f.ctx.sender).enemyKills).toBe(20n);
  expect(f.db.playerProgress.identity.find(f.ctx.sender).inventoryJson).toContain("sky_bow");
  f.patch("player", { mapId: "home_exterior" });
  f.run(server.recordCombatCheckpoint, { ...batch, progress: { ...progress, damage: 999_999 } });
  expect(update).toHaveBeenCalledTimes(1);
  expect(f.ctx.random.integerInRange).toHaveBeenCalledTimes(40);
});

it("recovers an unsent checkpoint from an unlocked map after reconnecting elsewhere", () => {
  const f = crystalFixture(); f.patch("player", { mapId: "home_exterior" });
  f.patch("playerProgress", { waterUnlocked: true });
  f.ctx.random.integerInRange = vi.fn(() => 1);
  f.run(server.recordCombatCheckpoint, { ...batch, progress: undefined });
  expect(f.ctx.random.integerInRange).toHaveBeenCalledTimes(40);
});

it("does not consume a receipt or grant stats/loot for a locked source map", () => {
  const f = crystalFixture(); f.patch("player", { mapId: "home_exterior" });
  const base = f.db.playerProgress.identity.find(f.ctx.sender);
  expect(() => f.run(server.recordCombatCheckpoint, { ...batch, progress: { ...base, damage: 9999, enemyKills: 10 } })).toThrow("another map");
  expect([...f.db.regularEnemyLootCursor.iter()]).toHaveLength(0);
  expect(f.db.playerProgress.identity.find(f.ctx.sender).damage).toBe(base.damage);
});

it("rolls back the receipt and stats if writing the loot fails", () => {
  const f = crystalFixture(); f.patch("player", { mapId: batch.mapId });
  const base = f.db.playerProgress.identity.find(f.ctx.sender);
  f.ctx.random.integerInRange = () => 1;
  const insert = vi.spyOn(f.db.playerItemDrop, "insert").mockImplementationOnce(() => { throw new Error("write failure"); });
  const request = { ...batch, progress: { ...base, damage: base.damage + 10, enemyKills: 20 } };
  expect(() => f.run(server.recordCombatCheckpoint, request)).toThrow("write failure");
  expect([...f.db.regularEnemyLootCursor.iter()]).toHaveLength(0);
  expect(f.db.playerProgress.identity.find(f.ctx.sender).damage).toBe(base.damage);
  expect([...f.db.playerLifetime.iter()]).toHaveLength(0);
  insert.mockRestore();
  f.run(server.recordCombatCheckpoint, request);
  expect(f.db.playerProgress.identity.find(f.ctx.sender).damage).toBe(base.damage + 10);
  expect([...f.db.playerItemDrop.iter()]).toHaveLength(2);
});
