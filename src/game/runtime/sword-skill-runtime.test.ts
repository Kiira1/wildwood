import { expect, it, vi } from "vitest";
import { createSwordSkillRuntime } from "./sword-skill-runtime";
import { createGameBootstrap } from "./game-bootstrap";
import type { EnemyShot, EnemyState } from "./types";
import type { SwordSkillRoll } from "../../../shared/sword-skills";

function harness(roll: Partial<SwordSkillRoll>) {
  const state = createGameBootstrap();
  Object.assign(state.player, { x: 0, y: 0, hp: 100, maxHp: 100, hurtClock: 0 });
  const hit = vi.fn(), effects = { spawnSwordSpin: vi.fn(), spawnSwordWave: vi.fn(), spawnDeflectedShot: vi.fn() };
  let now = 0, map = "first", weapon = "ion_sword", dueling = false;
  const runtime = createSwordSkillRuntime({ player: state.player, enemies: state.enemies, hit, effects,
    currentMapId: () => map, equippedWeapon: () => weapon, activeBoss: () => state.bosses.dragon,
    roll: () => roll, nowSeconds: () => now, random: () => 0, isDueling: () => dueling });
  const enemy = (x: number, y = 0, extra: Partial<EnemyState> = {}) => {
    const target = { x, y, r: 10, hp: 1e6, dead: false, ...extra } as EnemyState;
    state.enemies.push(target); return target;
  };
  return { ...state, runtime, hit, effects, enemy, at: (time: number) => { now = time; runtime.update(); },
    map: () => { map = "next"; }, weapon: () => { weapon = "starter_bow"; }, duel: () => { dueling = true; } };
}

it("sweeps three times around the moving player, excludes ghosts and caps each sweep", () => {
  const f = harness({ whirlwind: 100 });
  const first = f.enemy(40), movedNear = f.enemy(210);
  f.enemy(20, 0, { remoteCombatGhost: true });
  for (let index = 0; index < 7; index++) f.enemy(30 + index);
  f.runtime.swing(first, 100, true, 0);
  f.at(.19); expect(f.hit).not.toHaveBeenCalled();
  f.at(.2); expect(f.hit).toHaveBeenCalledTimes(6);
  expect(f.hit.mock.calls.every(call => call[1] === 45 && call[2] === true)).toBe(true);
  f.player.x = 200;
  f.at(.6);
  expect(f.hit.mock.calls.slice(6).map(call => call[0])).toEqual([movedNear, movedNear]);
  expect(f.player.swordSpinClock).toBeCloseTo(0);
  f.at(1); expect(f.hit).toHaveBeenCalledTimes(8);
});

it("sweeps a slow frame's wave in travel order, hits four distinct enemies and never behind the player", () => {
  const f = harness({ shockwave: 100 });
  const fifth = f.enemy(220), fourth = f.enemy(180), third = f.enemy(140), second = f.enemy(100), first = f.enemy(60);
  f.enemy(-60); f.enemy(100, 80); f.enemy(30, 0, { remoteCombatGhost: true });
  f.runtime.swing(first, 100, false, 0);
  f.at(.05); expect(f.hit).not.toHaveBeenCalled();
  f.at(.5);
  expect(f.hit.mock.calls.map(call => call[0])).toEqual([first, second, third, fourth]);
  expect(f.hit.mock.calls.some(call => call[0] === fifth)).toBe(false);
  expect(f.hit.mock.calls.every(call => call[1] === 80)).toBe(true);
  f.at(2); expect(f.hit).toHaveBeenCalledTimes(4);
});

it("hits the primary boss's ellipse with both skills without reaching nearby regular enemies", () => {
  const f = harness({ whirlwind: 100, shockwave: 100 });
  Object.assign(f.bosses.dragon, { x: 200, y: 120, r: 110, ry: 50, hitboxOffsetY: -120, dead: false });
  f.enemy(20);
  f.runtime.swing(f.bosses.dragon, 100, false, 0);
  f.at(.6);
  expect(f.hit).toHaveBeenCalledTimes(4);
  expect(f.hit.mock.calls.every(call => call[0] === f.bosses.dragon)).toBe(true);
});

it("deflects without losing health, caps the delayed return and shares the hurt window", () => {
  const f = harness({ deflect: 100 }), source = f.enemy(300);
  const shot = { x: 0, y: 0, r: 5, vx: -200, vy: 0, damage: 1e5, life: 2, source } satisfies EnemyShot;
  expect(f.runtime.deflect(shot)).toBe(true);
  expect(shot.life).toBe(0); expect(f.player.hp).toBe(100);
  expect(f.runtime.deflect({ ...shot, life: 2 })).toBe(false);
  f.at(.49); expect(f.hit).not.toHaveBeenCalled();
  f.at(.5); expect(f.hit).toHaveBeenCalledExactlyOnceWith(source, 100, false, 0, true);
  f.at(1); expect(f.hit).toHaveBeenCalledOnce();
});

it.each(["map", "weapon", "duel", "death", "clear"] as const)("cancels pending hits on %s", change => {
  const f = harness({ whirlwind: 100, shockwave: 100, deflect: 100 }), source = f.enemy(60);
  f.runtime.swing(source, 100, false, 0);
  f.runtime.deflect({ x: 0, y: 0, r: 5, vx: 0, vy: 0, damage: 20, life: 2, source });
  if (change === "death") f.player.hp = 0;
  else if (change === "clear") f.runtime.clear();
  else f[change]();
  f.at(1);
  expect(f.hit).not.toHaveBeenCalled(); expect(f.player.swordSpinClock).toBe(0);
});

it("never lands a delayed return on an enemy removed from this map", () => {
  const f = harness({ deflect: 100 }), source = f.enemy(300);
  f.runtime.deflect({ x: 0, y: 0, r: 5, vx: 0, vy: 0, damage: 20, life: 2, source });
  f.enemies.length = 0; f.at(1);
  expect(f.hit).not.toHaveBeenCalled();
});
