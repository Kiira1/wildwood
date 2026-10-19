import { MODULE_MIGRATION_VERSION } from "./module-migrations";
import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { rescaleEndgameProgress } from "../../shared/endgame-power-rescale";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

function fixture() {
  const f = crystalFixture();
  f.seed("moduleMigrationState", { id: 0, version: 25 });
  f.ctx.connectionId = null;
  // 63's Crude weapons have their own tests (starter-chest.test.ts).
  for (const who of [f.ctx.sender, identity("2"), identity("3")]) f.seed("playerStarterWeapon", { identity: who, kind: "all", at: f.ctx.timestamp });
  return f;
}

describe("endgame account migration", () => {
  it("backs up offline players, keeps ties and unlocks, and only converts once", () => {
    const f = fixture();
    const original = f.progress(identity("2"), {
      damage: 1e8, maxHp: 2e8, armor: 1e6, regen: 2e6,
      duskfallOrchardUnlocked: true, inventoryJson: '["basic_paper_hat"]',
    });
    f.progress(identity("3"), { ...original, identity: identity("3") });
    const low = progressOf(f, f.ctx.sender);
    f.run(server.onConnect);
    const next = progressOf(f, identity("2"));
    expect(next).toEqual(rescaleEndgameProgress(original));
    expect(progressOf(f, identity("3"))).toEqual({ ...next, identity: identity("3") });
    expect(progressOf(f, f.ctx.sender)).toEqual(low);
    expect(f.db.moduleMigrationState.id.find(0).version).toBe(MODULE_MIGRATION_VERSION);
    expect(f.db.playerBalanceVersion.identity.find(identity("2")).version).toBe(9);
    f.patch("playerProgress", { damage: next.damage + 1000 }, identity("2"));
    f.run(server.onConnect);
    expect(progressOf(f, identity("2")).damage).toBe(next.damage + 1000);
  });

  it("rolls back if a stat leaderboard would change even when power order survives", () => {
    const f = fixture();
    f.patch("playerProgress", { damage: 20_000, maxHp: 100 });
    f.progress(identity("2"), { damage: 30_000, maxHp: 1e8 });
    const before = [...f.db.playerProgress.iter()];
    expect(() => f.run(server.onConnect)).toThrow("fresh damage ranking audit");
    expect([...f.db.playerProgress.iter()]).toEqual(before);
    expect(f.db.moduleMigrationState.id.find(0).version).toBe(25);
  });
});
