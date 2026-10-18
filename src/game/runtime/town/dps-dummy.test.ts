import { describe, expect, it } from "vitest";
import { createGameBootstrap } from "../game-bootstrap";
import { createEnemyLifecycle } from "../enemies/enemy-lifecycle";
import type { MapId } from "../../world";
import { createDpsDummy, DPS_DUMMY_POSITION, DPS_FIGHT_IDLE_SECONDS, dummyDps } from "./dps-dummy";

function setup(map: MapId = "town") {
  const state = createGameBootstrap();
  state.enemies.length = 0; state.spawnSites.length = 0;
  state.player.damage = 50;
  let now = 100, mapId = map;
  const lifecycle = createEnemyLifecycle(state.enemies, state.spawnSites, () => {});
  const dummy = createDpsDummy({ player: state.player, enemies: state.enemies, spawnFromSite: lifecycle.spawnFromSite, currentMapId: () => mapId, now: () => now });
  return { ...state, dummy, advance: (seconds: number) => { now += seconds; }, setMap: (next: MapId) => { mapId = next; } };
}

describe("dummyDps", () => {
  it("is the fight's damage over its time, to now while it goes on and to its last hit after", () => {
    expect(dummyDps(null, 0)).toBeNull();
    // Ten hits of 90, a second apart: 90 a second.
    const fight = { startedAt: 10, lastHitAt: 19, total: 900, hits: 10 };
    expect(dummyDps(fight, 19)).toMatchObject({ dps: 90, going: true });
    expect(dummyDps(fight, 19 + DPS_FIGHT_IDLE_SECONDS + 1)).toMatchObject({ dps: 90, seconds: 10, going: false });
    expect(dummyDps({ startedAt: 5, lastHitAt: 5, total: 40, hits: 1 }, 5)?.dps).toBe(40);
  });
});

describe("the Town's training dummy", () => {
  it("stands in the Town only, still, whole and never a kill", () => {
    const s = setup();
    s.dummy.update();
    const dummy = s.enemies.find(enemy => enemy.trainingDummy)!;
    expect(dummy).toMatchObject({ x: DPS_DUMMY_POSITION.x, y: DPS_DUMMY_POSITION.y, damage: 0, speed: 0 });
    expect(dummy.trainingDummy?.readout).toBe("Attack Me");
    dummy.x += 40; dummy.hp -= 1_000; dummy.engaged = true;
    s.dummy.update();
    expect(dummy).toMatchObject({ x: DPS_DUMMY_POSITION.x, hp: dummy.maxHp, engaged: false, dead: false });
    expect(s.dummy.defeated(dummy)).toBe(true);
    s.setMap("tutorial_forest");
    s.dummy.update();
    expect(dummy.dead).toBe(true);
    const other = setup("tutorial_forest");
    other.dummy.update();
    expect(other.enemies).toHaveLength(0);
  });

  it("reads every hit to the unit and starts a new fight after a pause", () => {
    const s = setup();
    s.dummy.update();
    const dummy = s.enemies.find(enemy => enemy.trainingDummy)!;
    for (let second = 0; second < 10; second++) { dummy.hp -= 123; s.dummy.update(); s.advance(1); }
    expect(dummy.trainingDummy).toMatchObject({ readout: "123 DPS", detail: "1.23k in 10s" });
    s.advance(DPS_FIGHT_IDLE_SECONDS + 1);
    dummy.hp -= 7; s.dummy.update();
    expect(dummy.trainingDummy).toMatchObject({ readout: "7 DPS", detail: "7 in 1s" });
  });
});
