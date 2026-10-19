import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { defaultBalanceSettings, resolveMapBalance } from "../../shared/map-balance";
import { MODULE_MIGRATION_VERSION } from "./module-migrations";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("migration 55 re-pins a visit pinned before swords onto the current loot, which lists no gear now", () => {
  const f = crystalFixture();
  f.seed("moduleMigrationState", { id: 0, version: 54 });
  const snapshot = resolveMapBalance("beginner_desert", defaultBalanceSettings(), 0, 2);
  expect(snapshot.loot).toEqual([]);
  // Pinned long ago: the same visit, its loot still listing the map's old gear.
  f.seed("playerMapBalance", { identity: f.ctx.sender, mapId: "beginner_desert",
    snapshotJson: JSON.stringify({ ...snapshot, loot: [{ itemId: "iron_bow", wins: 1, outcomes: 50 }] }) });
  f.ctx.connectionId = null;
  f.run(server.onConnect);
  expect(f.db.moduleMigrationState.id.find(0).version).toBe(MODULE_MIGRATION_VERSION);
  // Nothing else of the visit moves: the same revision, enemies and timers.
  expect(JSON.parse(f.db.playerMapBalance.identity.find(f.ctx.sender).snapshotJson)).toEqual(snapshot);
});
