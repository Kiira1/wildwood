import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { defaultBalanceSettings, resolveMapBalance } from "../../shared/map-balance";
import { MODULE_MIGRATION_VERSION } from "./module-migrations";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("migration 58 puts the map's staff in the loot of a visit pinned before staffs", () => {
  const f = crystalFixture();
  f.seed("moduleMigrationState", { id: 0, version: 57 });
  const snapshot = resolveMapBalance("beginner_desert", defaultBalanceSettings(), 0, 2);
  const staff = snapshot.loot!.find(drop => drop.itemId === "desert_staff")!;
  expect(staff).toBeDefined();
  f.seed("playerMapBalance", { identity: f.ctx.sender, mapId: "beginner_desert",
    snapshotJson: JSON.stringify({ ...snapshot, loot: snapshot.loot!.filter(drop => drop !== staff) }) });
  f.ctx.connectionId = null;
  f.run(server.onConnect);
  expect(f.db.moduleMigrationState.id.find(0).version).toBe(MODULE_MIGRATION_VERSION);
  const pinned = JSON.parse(f.db.playerMapBalance.identity.find(f.ctx.sender).snapshotJson);
  expect(pinned.loot).toContainEqual(staff);
  expect({ ...pinned, loot: [] }).toEqual({ ...snapshot, loot: [] });
});
