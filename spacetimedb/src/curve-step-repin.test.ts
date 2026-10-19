import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { defaultBalanceSettings, resolveMapBalance } from "../../shared/map-balance";
import { MODULE_MIGRATION_VERSION } from "./module-migrations";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("migration 64 re-pins a visit pinned on the old curve steps onto the current curve", () => {
  const f = crystalFixture();
  f.seed("moduleMigrationState", { id: 0, version: 63 });
  const snapshot = resolveMapBalance("beginner_desert", defaultBalanceSettings(), 0, 2);
  // Pinned before the change: the same visit with the old enemy numbers.
  const old = structuredClone(snapshot);
  for (const enemy of Object.values(old.enemies)) { enemy.hp *= 2; enemy.reward = { ...enemy.reward, amount: enemy.reward.amount * 2 }; }
  f.seed("playerMapBalance", { identity: f.ctx.sender, mapId: "beginner_desert", snapshotJson: JSON.stringify(old) });
  f.ctx.connectionId = null;
  f.run(server.onConnect);
  expect(f.db.moduleMigrationState.id.find(0).version).toBe(MODULE_MIGRATION_VERSION);
  expect(JSON.parse(f.db.playerMapBalance.identity.find(f.ctx.sender).snapshotJson)).toEqual(snapshot);
});
