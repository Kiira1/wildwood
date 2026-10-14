import { describe, expect, it, vi } from "vitest";
import type { Identity } from "spacetimedb";
import { createRemoteCombatStatsService, remoteCombatStatsFromRows } from "./remote-combat-stats-service";

const identity = {} as Identity;

describe("remote combat stats", () => {
  it("shows a sword as one melee hit at its weapon range without changing saved stats", () => {
    const progress = { identity, maxHp: 100, damage: 10, attackRate: 1, projectileSpeed: 1000,
      projectileCount: 5, attackRange: 200, armor: 0, regen: 0, equippedHead: "", equippedChest: "",
      equippedRightHand: "wooden_sword", equippedLeftHand: "" };
    const sword = remoteCombatStatsFromRows(progress, null, []);
    expect(sword).toMatchObject({ melee: true, attackRange: 75, projectileCount: 1 });
    // One hit with the Wooden Sword's own +7.5%, never multiplied by the five projectiles.
    expect(sword.damage).toBeCloseTo(10.75);
    expect(progress.attackRange).toBe(200);
    expect(remoteCombatStatsFromRows({ ...progress, equippedRightHand: "starter_bow" }, null, []))
      .toMatchObject({ melee: false, attackRange: 200, projectileCount: 5 });
  });
  it("uses the same saved-stat, research, and projectile values as local combat", () => {
    const stats = remoteCombatStatsFromRows({
      identity,
      maxHp: 500,
      damage: 100,
      attackRate: 1.2,
      projectileSpeed: 780,
      projectileCount: 3,
      attackRange: 280,
      armor: 100,
      regen: 5,
      equippedHead: "",
      equippedChest: "",
      equippedRightHand: "",
      equippedLeftHand: "",
    }, {
      identity,
      warcraft: 5,
      precision: 2,
      regeneration: 3,
      criticalChance: 7,
      criticalDamage: 4,
    }, []);

    expect(stats).toMatchObject({
      maxHp: 500,
      armor: 104,
      attackInterval: 1.2,
      projectileSpeed: 780,
      projectileCount: 3,
      attackRange: 280,
      criticalChance: .07,
      criticalDamageMultiplier: 1.25,
    });
    expect(stats.damage).toBeCloseTo(110);
    expect(stats.regen).toBeCloseTo(5.3);
  });
  it("gives worn gear its slot's tier: upgrade rows are keyed by slot, not by item", () => {
    const stats = remoteCombatStatsFromRows({ identity, maxHp: 100, damage: 10, attackRate: 1, projectileSpeed: 1000,
      projectileCount: 1, attackRange: 200, armor: 0, regen: 10, equippedHead: "wood_full_helm",
      equippedChest: "wooden_armor", equippedRightHand: "starter_bow", equippedLeftHand: "" }, null, [
      { identity, itemId: "HAND", level: 10 },
      { identity, itemId: "CHEST", level: 4 },
      { identity, itemId: "HEAD", level: 7 },
    ]);
    // Each tier adds 4% of the item's own bonus: the bow's +5% damage is +7% at tier 10,
    // the armor's +5% health +5.8% at tier 4, the helm's +8.04% regen +10.29% at tier 7.
    expect(stats.damage).toBeCloseTo(10.7);
    expect(stats.maxHp).toBeCloseTo(105.8);
    expect(stats.regen).toBeCloseTo(11.029);
  });
});

describe("remote combat stats loading", () => {
  /** A connection whose subscriptions apply at once, counting each one. */
  function connection(players: string[]) {
    const counts = { subscribe: 0, unsubscribe: 0 };
    const progress = (hex: string) => ({ identity: { toHexString: () => hex }, maxHp: 100, damage: 10, attackRate: 1, projectileSpeed: 1000,
      projectileCount: 1, attackRange: 200, armor: 0, regen: 0, equippedHead: "", equippedChest: "", equippedRightHand: "", equippedLeftHand: "" });
    const conn = {
      db: {
        playerProgress: { iter: () => players.map(progress) },
        playerWideStats: { iter: () => [], identity: { find: () => undefined } },
        playerResearch: { iter: () => [] },
        playerItemUpgrade: { iter: () => [] },
      },
      subscriptionBuilder() {
        let applied = () => {};
        const builder = {
          onApplied(callback: () => void) { applied = callback; return builder; },
          onError() { return builder; },
          subscribe() {
            counts.subscribe += 1;
            const handle = { unsubscribe: () => { counts.unsubscribe += 1; } };
            queueMicrotask(() => applied());
            return handle;
          },
        };
        return builder;
      },
    };
    return { conn, counts };
  }

  it("loads each player on screen once, however many there are and however often they are asked for", async () => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const players = Array.from({ length: 20 }, (_, index) => `player-${index}`);
    const { conn, counts } = connection(players);
    let now = 0;
    const service = createRemoteCombatStatsService({
      connection: () => conn as never,
      identityFor: () => ({ toHexString: () => "" }) as never,
      nowMs: () => now,
    });
    // Ten seconds of frames, every player asked for each frame, as the enemy simulation does.
    for (let frame = 0; frame < 600; frame++) {
      now += 1_000 / 60;
      for (const player of players) service.api.remoteCombatStats(player);
      await Promise.resolve();
    }
    expect(counts.subscribe).toBe(players.length);
    expect(counts.unsubscribe).toBe(players.length);
    expect(service.api.remoteCombatStats("player-7")).toMatchObject({ maxHp: 100 });
    vi.unstubAllGlobals();
  });
});
