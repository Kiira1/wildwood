import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { fillDefeatBudget } from "../../tests/helpers/enemy-defeat";
import { STARTER_BOW } from "../../shared/items";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const MAP = "crystal_hollows", ENEMY = "Shard Hopper";

/** Counts calls to one table index's find while `run` runs. */
function counting(index: { find: (...args: any[]) => any }, run: () => void) {
  const find = index.find;
  let calls = 0;
  index.find = (...args: any[]) => { calls++; return find.apply(index, args); };
  try { run(); } finally { index.find = find; }
  return calls;
}

it("reads the save and the worn cards a few times per kill report, not once per helper", () => {
  // Since cards (0.903), each helper read the save and the gear's cards again: about eight progress
  // reads and eighteen card-slot reads a report, on the busiest reducer the game has.
  const f = crystalFixture();
  f.patch("playerProgress", { equippedRightHand: STARTER_BOW, inventoryJson: '["starter_bow"]', damage: 1e15 });
  fillDefeatBudget(f, MAP, ENEMY);
  let progressReads = 0;
  const slotReads = counting(f.db.playerGearSlots.key, () => {
    progressReads = counting(f.db.playerProgress.identity, () => {
      f.run(server.reportEnemyDefeats, { streamId: "read-count-stream-01", sequence: 1n, mapId: MAP, simulatedMillis: 30_000, enemies: [{ enemy: ENEMY, count: 5 }] });
    });
  });
  expect(Number(f.db.playerLifetime.identity.find(f.ctx.sender)?.enemyKills ?? 0n)).toBeGreaterThan(0);
  expect(progressReads).toBeLessThanOrEqual(4);
  expect(slotReads).toBeLessThanOrEqual(3);
});
