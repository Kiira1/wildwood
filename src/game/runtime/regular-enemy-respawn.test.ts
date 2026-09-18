import { describe, expect, it } from "vitest";
import type { SpawnSite } from "../world";
import {
  createRegularEnemyRespawnBoost,
  REGULAR_ENEMY_RESPAWN_SECONDS,
  REWARDED_REGULAR_ENEMY_RESPAWN_SECONDS,
  REWARDED_RESPAWN_BOOST_DURATION_MS,
} from "./regular-enemy-respawn";

function site(overrides: Partial<SpawnSite> = {}): SpawnSite {
  return {
    id: 0,
    x: 10,
    y: 20,
    campName: "Test camp",
    type: "Bramble",
    leashRange: 300,
    alive: true,
    respawnAt: 0,
    ...overrides,
  };
}

describe("regular enemy respawn boost", () => {
  it("schedules 20-second respawns before the reward and 10-second respawns after it", () => {
    let gameTime = 10;
    const first = site();
    const second = site({ id: 1 });
    const boost = createRegularEnemyRespawnBoost([first, second], () => gameTime);

    boost.schedule(first);
    expect(first).toMatchObject({ alive: false, respawnAt: gameTime + REGULAR_ENEMY_RESPAWN_SECONDS });

    gameTime = 20;
    expect(boost.activate()).toBe(true);
    boost.schedule(second);
    expect(second).toMatchObject({ alive: false, respawnAt: gameTime + REWARDED_REGULAR_ENEMY_RESPAWN_SECONDS });
    expect(boost.respawnSeconds()).toBe(REWARDED_REGULAR_ENEMY_RESPAWN_SECONDS);
  });

  it("supports a caller-scoped local test multiplier without changing defaults", () => {
    const localSite = site();
    const boost = createRegularEnemyRespawnBoost([localSite], () => 10, Date.now, 0, 3);

    boost.schedule(localSite);
    expect(localSite.respawnAt).toBeCloseTo(10 + 20 / 3);
    expect(boost.respawnSeconds()).toBeCloseTo(20 / 3);
  });

  it("rebases pending timers to 10 seconds from their original defeat", () => {
    const pending = site({ alive: false, respawnAt: 40 });
    const boost = createRegularEnemyRespawnBoost([pending], () => 20);

    boost.activate();

    expect(pending.respawnAt).toBe(30);
  });

  it("makes overdue boosted timers immediately eligible without changing live enemies", () => {
    const overdue = site({ alive: false, respawnAt: 40 });
    const alive = site({ id: 1, alive: true, respawnAt: 0 });
    const boost = createRegularEnemyRespawnBoost([overdue, alive], () => 35);

    boost.activate();

    expect(overdue.respawnAt).toBe(35);
    expect(alive).toMatchObject({ alive: true, respawnAt: 0 });
  });

  it("is idempotent and never shortens timers twice", () => {
    const pending = site({ alive: false, respawnAt: 40 });
    const boost = createRegularEnemyRespawnBoost([pending], () => 20);

    expect(boost.activate()).toBe(true);
    expect(boost.activate()).toBe(false);
    expect(pending.respawnAt).toBe(30);
  });

  it("expires after 30 real-time minutes", () => {
    let nowMs = 1_000;
    const boost = createRegularEnemyRespawnBoost([], () => 0, () => nowMs);

    boost.activate();
    expect(boost.activeUntilMs()).toBe(nowMs + REWARDED_RESPAWN_BOOST_DURATION_MS);
    expect(boost.remainingMs()).toBe(REWARDED_RESPAWN_BOOST_DURATION_MS);
    nowMs += REWARDED_RESPAWN_BOOST_DURATION_MS;
    expect(boost.isActive()).toBe(false);
    expect(boost.respawnSeconds()).toBe(REGULAR_ENEMY_RESPAWN_SECONDS);
  });

  it("restores an unexpired earned boost", () => {
    const boost = createRegularEnemyRespawnBoost([], () => 0, () => 5_000, 25_000);

    expect(boost.isActive()).toBe(true);
    expect(boost.remainingMs()).toBe(20_000);
    expect(boost.respawnSeconds()).toBe(REWARDED_REGULAR_ENEMY_RESPAWN_SECONDS);
  });
});
it('uses the current map configuration and halves it for rewarded respawns', () => {
  let seconds = 40;
  const target = site(); const boost = createRegularEnemyRespawnBoost([target], () => 10, Date.now, 0, 1, () => seconds);
  boost.schedule(target); expect(target.respawnAt).toBe(50);
  boost.activate(); expect(target.respawnAt).toBe(30);
  seconds = 60; expect(boost.respawnSeconds()).toBe(30);
});
