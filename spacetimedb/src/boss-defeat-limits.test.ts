import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { bossDefeatLimits } from "./boss-defeat-limits";
import { beginBossTimeBudget } from "./enemy-defeats";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { personalBossDefinition } from "../../shared/personal-bosses";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

function fixture(mapId = "tutorial_forest", fightSeconds = 100) {
  const f = crystalFixture();
  f.patch("player", { mapId });
  // Starter bow adds 5% damage; one shot/s, one projectile. The first
  // shot allowance makes this exactly fightSeconds of required combat time.
  const stats = { damage: personalBossDefinition(mapId)!.hp / (fightSeconds + 1) / 1.05,
    attackRate: 1, projectileCount: 1, inventoryJson: '["starter_bow"]', equippedRightHand: "starter_bow" };
  f.patch("playerProgress", stats);
  const start = f.ctx.timestamp.microsSinceUnixEpoch;
  let sequence = 0n;
  return { ...f, stats,
    begin: () => f.run(ctx => beginBossTimeBudget(ctx, mapId)),
    at: (seconds: number) => { f.ctx.timestamp = new Timestamp(start + BigInt(Math.round(seconds * 1e6))); },
    claim: (count = 1, freshStream = false) => {
      sequence++;
      f.run(server.recordEnemyDefeats, { mapId, streamId: freshStream ? `boss-validation-stream-${sequence}` : "boss-validation-stream-01",
        sequence: freshStream ? 1n : sequence, enemies: [{ enemy: "boss", count }] });
    },
    kills: () => f.db.playerLifetime.identity.find(f.ctx.sender)?.enemyKills ?? 0n,
  };
}

describe("boss time validation", () => {
  it("bounds a five-minute batch using HP, DPS, and the actual respawn delay", () => {
    expect(bossDefeatLimits(100_000, 1_000, 1, 45)?.windowKills).toBe(2);
    expect(bossDefeatLimits(1, 1_000, 1, 45)?.windowKills).toBe(7);
    expect(bossDefeatLimits(1, 1_000, 1, 60)?.windowKills).toBe(6);
    for (const dps of [0, -1, NaN, Infinity]) expect(bossDefeatLimits(100, dps, 1, 45)).toBeNull();
  });

  it("rejects the dev-browser exploit: one or twenty impossible Endless kills grant nothing", () => {
    const f = fixture("endless_11", 50_000);
    const before = f.db.playerProgress.identity.find(f.ctx.sender);
    f.claim(1); f.claim(20, true);
    expect(f.kills()).toBe(0n);
    expect(f.db.playerProgress.identity.find(f.ctx.sender)).toEqual(before);
    expect(f.db.proceduralProgress.identity.find(f.ctx.sender)).toBeNull();
    expect(() => f.run(server.changeMap, { mapId: "home_exterior", x: 600, y: 700 })).not.toThrow();
  });

  it("shares a rolling cap between batches, fresh streams, and reconnects", () => {
    const f = fixture();
    f.claim(20, true);
    expect(f.kills()).toBe(2n);
    // Restore this test's DPS after legitimate rewards to isolate time limits.
    f.patch("playerProgress", f.stats);
    f.at(299); f.begin(); f.claim(20, true);
    expect(f.kills()).toBe(2n);
    f.at(300); f.claim(20, true);
    expect(f.kills()).toBe(4n);
  });

  it("requires elapsed combat time on a newly entered map", () => {
    const f = fixture();
    f.begin();
    f.claim(); expect(f.kills()).toBe(0n);
    f.at(99); f.claim(); expect(f.kills()).toBe(0n);
    f.at(100); f.claim(); expect(f.kills()).toBe(1n);
    f.patch("playerProgress", f.stats);
    f.at(244); f.claim(); expect(f.kills()).toBe(1n);
    f.at(245); f.claim(); expect(f.kills()).toBe(2n);
  });

  it("carries time for a slow fight without granting a free first kill or reset credit", () => {
    const f = fixture("tutorial_forest", 600);
    f.begin();
    f.at(300); f.claim(); expect(f.kills()).toBe(0n);
    f.at(599); f.begin(); f.claim(); expect(f.kills()).toBe(0n);
    f.at(600); f.claim(); expect(f.kills()).toBe(1n);
    f.patch("playerProgress", f.stats);
    f.at(900); f.claim(); expect(f.kills()).toBe(1n);
    f.at(1245); f.claim(); expect(f.kills()).toBe(2n);
  });

  it("cannot claim with an empty weapon slot or turn projectile count into sword DPS", () => {
    const unarmed = fixture();
    unarmed.patch("playerProgress", { equippedRightHand: "", damage: 1e30 });
    unarmed.claim(20); expect(unarmed.kills()).toBe(0n);
    const sword = fixture("endless_11", 50_000);
    sword.patch("playerProgress", { inventoryJson: '["wooden_sword"]', equippedRightHand: "wooden_sword", projectileCount: 100 });
    sword.claim(); expect(sword.kills()).toBe(0n);
  });

  it("honors server research, ranged volleys, and possible Endless criticals", () => {
    const ranged = fixture("endless_11", 400);
    ranged.claim(); expect(ranged.kills()).toBe(0n);
    ranged.patch("playerProgress", { projectileCount: 2 });
    // Rejected claims retain the already-earned time, so the stronger build
    // can now legitimately fit a kill into the available five-minute credit.
    ranged.claim(); expect(ranged.kills()).toBe(1n);
    const researched = fixture("endless_11", 600);
    researched.claim(); expect(researched.kills()).toBe(0n);
    researched.seed("playerResearch", { identity: researched.ctx.sender, warcraft: 50,
      criticalChance: 1, criticalDamage: 20 });
    researched.claim(); expect(researched.kills()).toBe(1n);
  });

  it("clamps legacy attack intervals to the actual attack-speed cap", () => {
    const f = fixture("endless_11", 1_000);
    f.patch("playerProgress", { attackRate: .000001 });
    f.claim(20); expect(f.kills()).toBe(0n);
  });

  it("includes validated regular-kill gains in the same save, regardless of entry order", () => {
    const f = fixture();
    f.patch("playerProgress", { damage: 100 });
    f.claim(); expect(f.kills()).toBe(0n);
    f.run(server.recordEnemyDefeats, { mapId: "tutorial_forest", streamId: "mixed-boss-save-window-01", sequence: 1n,
      enemies: [{ enemy: "boss", count: 1 }, { enemy: "Cindermaw", count: 99 }] });
    expect(f.kills()).toBe(100n);
    expect(f.db.playerProgress.identity.find(f.ctx.sender).desertUnlocked).toBe(true);
  });
});
