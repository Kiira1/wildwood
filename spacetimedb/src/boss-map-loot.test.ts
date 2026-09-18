import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { regularMapLoot } from "../../shared/regular-map-loot";
import { personalBossDefinition } from "../../shared/personal-bosses";
import { MAP_IDS } from "../../shared/rules";
import { Timestamp } from "spacetimedb";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

function fixture(mapId: string) {
  const f = crystalFixture();
  f.patch("player", { mapId });
  f.patch("playerProgress", { damage: personalBossDefinition(mapId)!.hp, attackRate: 1, projectileCount: 1, inventoryJson: '["starter_stone"]', equippedRightHand: "starter_stone" });
  f.ctx.random.integerInRange = vi.fn(() => 1);
  const batch = { mapId, streamId: "boss-map-loot-stream-01", sequence: 1n, enemies: [{ enemy: "boss", count: 1 }] };
  return { ...f, batch, claim: () => f.run(server.recordEnemyDefeats, batch) };
}
it.each(MAP_IDS)("lets the %s boss award every local regular drop, once per accepted clear", mapId => {
  const f = fixture(mapId); f.claim();
  const inventory = JSON.parse(f.db.playerProgress.identity.find(f.ctx.sender).inventoryJson);
  const drops = [...f.db.playerItemDrop.iter()];
  for (const drop of regularMapLoot(mapId)) {
    expect(inventory).toContain(drop.itemId);
    expect(drops.filter(row => row.itemId === drop.itemId)).toHaveLength(1);
    expect(f.ctx.random.integerInRange).toHaveBeenCalledWith(1, drop.outcomes);
  }
  const calls = vi.mocked(f.ctx.random.integerInRange).mock.calls.length;
  f.claim();
  expect(f.ctx.random.integerInRange).toHaveBeenCalledTimes(calls);
  expect([...f.db.playerItemDrop.iter()]).toHaveLength(drops.length);
});
it.each([["intermediate_snowlands", ["frost_bow", "frost_armor"]], ["advanced_lava_wastes", ["lava_bow"]]] as const)("preserves the exclusive boss drops in %s", (mapId, exclusive) => {
  const f = fixture(mapId); f.claim();
  const inventory = JSON.parse(f.db.playerProgress.identity.find(f.ctx.sender).inventoryJson);
  for (const id of exclusive) expect(inventory).toContain(id);
});
it("emits already-owned events on repeat wins without duplicating inventory", () => {
  const f = fixture("tutorial_forest"); f.claim();
  f.ctx.timestamp = new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + 60_000_000n);
  f.patch("player", { lastInputAt: f.ctx.timestamp });
  f.run(server.recordEnemyDefeats, { ...f.batch, sequence: 2n });
  const inventory = JSON.parse(f.db.playerProgress.identity.find(f.ctx.sender).inventoryJson);
  for (const drop of regularMapLoot("tutorial_forest")) expect(inventory.filter((id: string) => id === drop.itemId)).toHaveLength(1);
  expect([...f.db.playerItemDrop.iter()].filter(row => row.alreadyOwned)).toHaveLength(regularMapLoot("tutorial_forest").length);
});
it("does not roll equipment for a boss kill rejected by combat validation", () => {
  const f = fixture("ion_citadel"); f.patch("playerProgress", { damage: 1 });
  f.claim();
  expect(f.ctx.random.integerInRange).not.toHaveBeenCalled();
  expect([...f.db.playerItemDrop.iter()]).toHaveLength(0);
});
