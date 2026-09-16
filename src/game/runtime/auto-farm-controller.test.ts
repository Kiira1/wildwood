import { describe, expect, it } from 'vitest';
import { createGameBootstrap } from './game-bootstrap';
import { createEnemyLifecycle } from './enemy-lifecycle';
import { createAutoFarmController } from './auto-farm-controller';
import type { SpawnSite } from '../world';
import type { EnemyKind } from '../enemies';
import type { Circle } from './types';
import type { Movement } from './player-input-controller';
const idle: Movement = { x: 0, y: 0, source: 'none' };

function setup(obstacles: Circle[] = [], weapon = "starter_bow") {
  const state = createGameBootstrap();
  state.enemies.length = 0;
  state.spawnSites.length = 0;
  Object.assign(state.player, { x: 500, y: 500, attackRange: 200, speed: 300 });
  let map = 'forest', unavailable: string | null = null, paused = false;
  const lifecycle = createEnemyLifecycle(state.enemies, state.spawnSites, () => {});
  const add = (type: EnemyKind, x: number, y: number) => {
    const site: SpawnSite = { id: state.spawnSites.length, type, x, y, campName: type, leashRange: 500, alive: false, respawnAt: 0 };
    state.spawnSites.push(site);
    lifecycle.spawnFromSite(site);
    return state.enemies[state.enemies.length - 1];
  };
  const farm = createAutoFarmController({
    ...state, mapId: () => map, unavailable: () => unavailable, paused: () => paused,
    speed: () => state.player.speed, obstacles: () => obstacles, equippedWeapon: () => weapon,
  });
  const tick = () => {
    const movement = farm.movement(idle, 1 / 60);
    state.player.x += movement.x * state.player.speed / 60;
    state.player.y += movement.y * state.player.speed / 60;
    return movement;
  };
  return { ...state, farm, tick, add,
    setMap: (value: string) => { map = value; },
    setUnavailable: (value: string | null) => { unavailable = value; },
    setPaused: (value: boolean) => { paused = value; },
  };
}

describe('autofarm', () => {
  it('keeps same-species generated camps separate when routing', () => {
    const s = setup(); s.setMap('endless_1');
    const armor = s.add('Bramble', 550, 500), health = s.add('Bramble', 1500, 500);
    armor.campName = s.spawnSites[0].campName = 'Armor Camp';
    health.campName = s.spawnSites[1].campName = 'Health Camp';
    const choices = s.farm.choices();
    expect(choices).toHaveLength(2);
    const choice = choices.find(c => c.camp === 'Health Camp')!;
    expect(s.farm.start(choice.key)).toBe(true);
    expect(s.tick().x).toBeGreaterThan(0);
    expect(s.farm.targetType()).toBe('Bramble');
    expect(s.farm.targetCamp()).toBe('Health Camp');
    health.dead = true;
    expect(s.tick().x).toBeGreaterThan(0);
  });

  it('never detours toward an engaged generated boss', () => {
    const s = setup(); s.setMap('endless_1');
    const target = s.add('Bramble', 1500, 500);
    target.campName = s.spawnSites[0].campName = 'Health Camp';
    const boss = s.add('Bramble', 500, 900);
    Object.assign(boss, { generatedBoss: true, engaged: true, aggroTargetId: null, campName: 'Warden' });
    s.spawnSites.pop(); // Bosses are not regular respawning camp sites.
    expect(s.farm.choices()).toHaveLength(1);
    s.farm.start(s.farm.choices()[0].key);
    expect(s.tick()).toEqual({ x: 1, y: 0, source: 'keyboard' });
    target.dead = true;
    expect(s.tick().y).toBe(0);
  });

  it('walks to the selected type at ordinary speed and stops inside attack range', () => {
    const s = setup();
    s.add('Needle', 500, 520);
    s.add('Bramble', 1500, 500);
    expect(s.farm.start('Bramble')).toBe(true);
    const first = s.tick();
    expect(first).toEqual({ x: 1, y: 0, source: 'keyboard' });
    for (let i = 0; i < 300; i++) s.tick();
    expect(s.player.x).toBeCloseTo(1344);
    expect(s.player.y).toBe(500);
    expect(s.farm.state().status).toBe('Farming');
    expect(s.farm.targetType()).toBe('Bramble');
  });

  it('stops to fight an attacker of another type, then resumes its original farm route', () => {
    const s = setup();
    s.add('Bramble', 1500, 500);
    const attacker = s.add('Needle', 500, 550);
    s.farm.start('Bramble');
    expect(s.tick().x).toBeGreaterThan(0);
    attacker.engaged = true;
    attacker.aggroTargetId = 'local-player';
    expect(s.tick()).toEqual(idle);
    expect(s.farm.state()).toMatchObject({ active: true, selected: 'Bramble', status: 'Defending' });
    attacker.dead = true;
    expect(s.tick().x).toBeGreaterThan(0);
    expect(s.farm.targetType()).toBe('Bramble');
  });

  it('does not detour for enemies fighting someone else or returning to their spawn', () => {
    const s = setup(); s.add('Bramble', 1500, 500);
    const attacker = s.add('Needle', 500, 550);
    attacker.engaged = true;
    attacker.aggroTargetId = 'another-player';
    s.farm.start('Bramble');
    expect(s.tick().x).toBeGreaterThan(0);
    attacker.aggroTargetId = 'local-player'; attacker.leashing = true;
    expect(s.tick().x).toBeGreaterThan(0);
    attacker.leashing = false; attacker.remoteCombatGhost = true;
    expect(s.tick().x).toBeGreaterThan(0);
  });

  it('reaches firing range even when the nearest firing position is inside an obstacle', () => {
    const obstacle = { x: 950, y: 500, r: 100 };
    const s = setup([obstacle]); s.add('Bramble', 1100, 500); s.farm.start('Bramble');
    for (let i = 0; i < 300; i++) {
      s.tick();
      expect(Math.hypot(s.player.x - obstacle.x, s.player.y - obstacle.y)).toBeGreaterThanOrEqual(obstacle.r - .001);
    }
    expect(s.farm.state().status).toBe('Farming');
  });

  it('reacquires after a kill, waits at a spawn, and resumes when an enemy respawns', () => {
    const s = setup();
    const first = s.add('Bramble', 600, 500), second = s.add('Bramble', 1200, 500);
    s.farm.start('Bramble'); s.tick();
    expect(s.farm.state().status).toBe('Farming');
    first.dead = true;
    expect(s.tick().x).toBeGreaterThan(0);
    second.dead = true;
    s.tick();
    expect(s.farm.state().status).toBe('Waiting for respawn');
    second.dead = false;
    expect(s.tick().x).toBeGreaterThan(0);
    expect(s.farm.choices()[0]).toMatchObject({ type: 'Bramble', alive: 1, total: 2 });
  });

  it('excludes presentation ghosts and retains a living target instead of oscillating', () => {
    const s = setup();
    const a = s.add('Bramble', 900, 500), b = s.add('Bramble', 500, 1000);
    const ghost = s.add('Bramble', 500, 510); ghost.remoteCombatGhost = true;
    s.farm.start('Bramble');
    expect(s.tick().x).toBeGreaterThan(0);
    b.y = 700;
    expect(s.tick().x).toBeGreaterThan(0);
    a.dead = true;
    expect(s.tick().y).toBeGreaterThan(0);
  });

  it('manual movement takes priority and autofarm resumes on release', () => {
    const s = setup(); s.add('Bramble', 1500, 500); s.farm.start('Bramble');
    const manual: Movement = { x: -.4, y: .2, source: 'touch' };
    expect(s.farm.movement(manual, 1 / 60)).toBe(manual);
    expect(s.farm.targetType()).toBe('Bramble');
    expect(s.farm.state()).toMatchObject({ active: true, status: 'Manual control' });
    expect(s.tick().x).toBeGreaterThan(0);
    expect(s.farm.state().active).toBe(true);
  });

  it('pauses movement while a window is open and resumes on close', () => {
    const s = setup(); s.add('Bramble', 1500, 500); s.farm.start('Bramble');
    s.setPaused(true);
    expect(s.tick()).toEqual(idle);
    expect(s.farm.state()).toMatchObject({ active: true, status: 'Paused' });
    s.setPaused(false);
    expect(s.tick().x).toBeGreaterThan(0);
  });

  it('stops on map changes, unavailable gameplay, and rejects enemies absent from the map', () => {
    const s = setup(); s.add('Bramble', 1500, 500);
    expect(s.farm.start('Needle')).toBe(false);
    s.farm.start('Bramble'); s.setMap('desert');
    expect(s.tick()).toEqual(idle);
    expect(s.farm.state().active).toBe(false);
    s.farm.start('Bramble'); s.setUnavailable('Disconnected'); s.farm.refresh();
    expect(s.farm.state()).toMatchObject({ active: false, status: 'Disconnected' });
    expect(s.farm.start('Bramble')).toBe(false);
  });
});

it("closes to sword reach without changing the player camera range", () => {
  const s = setup([], "wooden_sword"), enemy = s.add("Spitter", 800, 500);
  s.farm.start("Spitter");
  for (let i = 0; i < 300; i++) s.tick();
  expect(Math.hypot(enemy.x - s.player.x, enemy.y - s.player.y) - enemy.r).toBeLessThan(75);
  expect(s.player.attackRange).toBe(200);
});
