import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { defaultBalanceSettings, resolveMapBalance } from "../../shared/map-balance";
import { MODULE_MIGRATION_VERSION } from "./module-migrations";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("migration 55 puts the map's sword in the loot of a visit pinned before swords", () => {
  const f = crystalFixture();
  f.seed("moduleMigrationState", { id: 0, version: 54 });
  const snapshot = resolveMapBalance("beginner_desert", defaultBalanceSettings(), 0, 2);
  const sword = snapshot.loot!.find(drop => drop.itemId.endsWith("_sword"))!;
  expect(sword).toBeDefined();
  // Pinned before 0.902: the same visit, its loot without the sword. Kills roll from the pin until the player travels.
  f.seed("playerMapBalance", { identity: f.ctx.sender, mapId: "beginner_desert",
    snapshotJson: JSON.stringify({ ...snapshot, loot: snapshot.loot!.filter(drop => drop !== sword) }) });
  f.ctx.connectionId = null;
  f.run(server.onConnect);
  expect(f.db.moduleMigrationState.id.find(0).version).toBe(MODULE_MIGRATION_VERSION);
  const pinned = JSON.parse(f.db.playerMapBalance.identity.find(f.ctx.sender).snapshotJson);
  expect(pinned.loot).toContainEqual(sword);
  // Nothing else of the visit moves: the same revision, enemies and timers.
  expect({ ...pinned, loot: [] }).toEqual({ ...snapshot, loot: [] });
});
