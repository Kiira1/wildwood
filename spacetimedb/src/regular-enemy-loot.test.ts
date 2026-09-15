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
