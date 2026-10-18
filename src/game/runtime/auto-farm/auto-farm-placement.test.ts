import { describe, expect, it } from 'vitest';
import { createGameBootstrap } from '../game-bootstrap';
import { createEnemyLifecycle } from '../enemies/enemy-lifecycle';
import { CAMP_STINT_SECONDS, COMMIT_HEALTH_WAIT_MS, createAutoFarmController } from './auto-farm-controller';
import { createAutoFarmResumeStore } from '../../../app/auto-farm-resume';
import { ENEMY_TYPES, type EnemyKind } from '../../enemies';
import type { SpawnSite } from '../../world';
import type { Movement } from '../player-input-controller';
import { bossAggroRange, BOSS_ZONE_PAD } from './boss-zone';

const idle: Movement = { x: 0, y: 0, source: 'none' };
const health = `stat:${ENEMY_TYPES.Bramble.reward.type}`, speed = `stat:${ENEMY_TYPES.Needle.reward.type}`;

function farmWith(extra: Partial<Parameters<typeof createAutoFarmController>[0]> = {}, map = 'forest') {
  const state = createGameBootstrap();
  state.enemies.length = 0; state.spawnSites.length = 0;
  Object.assign(state.player, { x: 500, y: 500, attackRange: 200, speed: 300 });
  let now = 0;
  const values = new Map<string, string>();
  const memory = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const lifecycle = createEnemyLifecycle(state.enemies, state.spawnSites, () => {});
  const add = (type: EnemyKind, x: number, y: number) => {
    const site: SpawnSite = { id: state.spawnSites.length, type, x, y, campName: type, leashRange: 500, alive: false, respawnAt: 0 };
    state.spawnSites.push(site); lifecycle.spawnFromSite(site);
    return state.enemies[state.enemies.length - 1];
  };
  const farm = createAutoFarmController({ ...state, mapId: () => map, unavailable: () => null, paused: () => false,
    speed: () => 300, obstacles: () => [], localIdentity: () => 'me', now: () => now, resumeStore: createAutoFarmResumeStore(() => memory),
    priorityStorage: () => memory, equippedWeapon: () => 'starter_bow', ...extra });
  /** One frame, the player stepping as the farm asks. */
  const tick = (dt = 1 / 60) => {
    now += dt * 1000;
    const movement = farm.movement(idle, dt);
    state.player.x += movement.x * 300 * dt; state.player.y += movement.y * 300 * dt;
    return movement;
  };
  return { ...state, farm, add, tick, advance: (ms: number) => { now += ms; } };
}

describe('autofarm placement', () => {
  it('walks a sword into its own reach of an enemy that woke, where a bow waits for it at range', () => {
    for (const weapon of ['wooden_sword', 'starter_bow']) {
      const s = farmWith({ equippedWeapon: () => weapon });
      // Speed on Aggro makes Pull bring something, as most players set it; health is farmed.
      s.add('Needle', 2_500, 2_500);
      s.farm.setGroupPulled(speed, true);
      const mob = s.add('Bramble', 900, 500);
      mob.engaged = true; mob.aggroTargetId = 'someone-else';
      s.farm.start({ [health]: 100, [speed]: 0 });
      const step = s.tick();
      if (weapon === 'wooden_sword') {
        expect(step.x).toBeGreaterThan(0);
        expect(s.farm.state().status).toBe('Moving to enemy');
      } else expect(s.farm.state().status).toBe('Pulling');
    }
  });

  it('goes to the boss and the next map healed: it farms on while hurt, and goes at half health after a minute', () => {
    const boss = { x: 2_000, y: 500, r: 60, hp: 1_000, maxHp: 1_000 };
    const s = farmWith({ power: () => 1e9, bossPower: () => 1, mapBoss: () => boss, bossUnlocksNext: () => true });
    s.add('Bramble', 500, 1_500);
    s.farm.setAdvance(true);
    s.farm.start([health]);
    s.player.hp = s.player.maxHp * .2;
    s.tick();
    expect(s.farm.state().phase).toBe('farm');
    expect(s.farm.bossStatus()).toBe('Boss Once Healed');
    s.player.hp = s.player.maxHp * .6;
    s.advance(COMMIT_HEALTH_WAIT_MS); s.tick();
    expect(s.farm.state().phase).toBe('boss');
    // Healed, it goes at once.
    const t = farmWith({ power: () => 1e9, bossPower: () => 1, mapBoss: () => boss, bossUnlocksNext: () => true });
    t.add('Bramble', 500, 1_500);
    t.farm.setAdvance(true);
    t.farm.start([health]);
    t.player.hp = t.player.maxHp * .95;
    t.tick();
    expect(t.farm.state().phase).toBe('boss');
  });

  it('waits for health before Move On, but goes straight on after a boss win whatever its health', () => {
    const portal = { x: 200, y: 500, destination: 'beginner_desert' };
    const s = farmWith({ power: () => 1e9, mapPower: () => 1, nextPortal: () => portal });
    s.add('Bramble', 900, 500);
    s.farm.setAdvance(true);
    s.farm.start([health]);
    s.player.hp = s.player.maxHp * .3;
    s.tick();
    expect(s.farm.state().phase).toBe('farm');
    expect(s.farm.moveStatus()).toBe('Moving On Once Healed');
    s.player.hp = s.player.maxHp; s.advance(1_000); s.tick();
    expect(s.farm.state().phase).toBe('portal');

    const boss = { x: 900, y: 500, r: 60, hp: 1_000, maxHp: 1_000, dead: false };
    const t = farmWith({ power: () => 1e9, mapPower: () => 1, bossPower: () => 1, mapBoss: () => boss as never,
      bossUnlocksNext: () => !boss.dead, nextPortal: () => boss.dead ? portal : null });
    t.add('Bramble', 500, 1_500);
    t.farm.setAdvance(true); t.farm.setAdvance(true);
    t.farm.start([health]);
    t.tick();
    expect(t.farm.state().phase).toBe('boss');
    boss.dead = true; t.player.hp = t.player.maxHp * .2;
    t.tick();
    expect(t.farm.state().phase).toBe('portal');
  });

  describe("keeps out of a boss's range while not fighting it", () => {
    const map = 'tutorial_forest', pit = { x: 1_500, y: 1_500 };
    const zone = bossAggroRange(map)! + BOSS_ZONE_PAD;
    const near = (s: ReturnType<typeof farmWith>) => Math.hypot(s.player.x - pit.x, s.player.y - pit.y);

    it('farms an enemy outside it before a nearer one inside, and routes round it', () => {
      const boss = { ...pit, r: 80, hp: 100, maxHp: 100 };
      const s = farmWith({ mapBoss: () => boss }, map);
      s.player.x = pit.x - zone - 100; s.player.y = pit.y;
      s.add('Bramble', pit.x - 200, pit.y);
      const outside = s.add('Bramble', pit.x - zone - 100, pit.y + 900);
      s.farm.start([health]);
      let closest = Infinity;
      for (let frame = 0; frame < 60 * 6; frame++) { s.tick(); closest = Math.min(closest, near(s)); }
      expect(closest).toBeGreaterThanOrEqual(zone - 2);
      expect(Math.hypot(s.player.x - outside.x, s.player.y - outside.y)).toBeLessThan(220);
    });

    it("leaves a boss fight the player walked into alone: neither in nor out, until they leave or it is down", () => {
      const boss = { ...pit, r: 80, hp: 1_000, maxHp: 1_000, dead: false };
      const s = farmWith({ mapBoss: () => boss }, map);
      s.player.x = pit.x - 300; s.player.y = pit.y;
      s.add('Bramble', pit.x - zone - 300, pit.y);
      s.farm.start([health]);
      s.farm.movement({ x: 1, y: 0, source: 'keyboard' }, 1 / 60);
      const at = { x: s.player.x, y: s.player.y };
      for (let frame = 0; frame < 60 * 3; frame++) expect(s.tick()).toMatchObject({ x: 0, y: 0 });
      expect(s.player).toMatchObject(at);
      expect(s.farm.state().status).toBe('Your boss fight');
      expect(s.farm.attackType()).toBeNull();
      // Down, it farms again, out of the pit.
      boss.dead = true;
      for (let frame = 0; frame < 60 * 3; frame++) s.tick();
      expect(near(s)).toBeGreaterThan(300);
      // Stepping out of the range by hand ends it too.
      const t = farmWith({ mapBoss: () => ({ ...pit, r: 80, hp: 1_000, maxHp: 1_000 }) }, map);
      t.player.x = pit.x - 300; t.player.y = pit.y;
      t.add('Bramble', pit.x - zone - 300, pit.y);
      t.farm.start([health]);
      t.farm.movement({ x: 1, y: 0, source: 'keyboard' }, 1 / 60);
      t.player.x = pit.x - zone - 50;
      t.farm.movement({ x: -1, y: 0, source: 'keyboard' }, 1 / 60);
      expect(t.tick().x).not.toBe(0);
    });

    it('stands where the player left it when only Aggro is on: in the pit, by the boss or among other camps', () => {
      const boss = { ...pit, r: 80, hp: 100, maxHp: 100 };
      const s = farmWith({ mapBoss: () => boss }, map);
      s.add('Bramble', 600, 600);
      s.add('Needle', pit.x + 120, pit.y);
      s.farm.setGroupPulled(health, true);
      s.farm.startZero();
      s.player.x = pit.x + 50; s.player.y = pit.y;
      const at = { x: s.player.x, y: s.player.y };
      for (let frame = 0; frame < 60 * 8; frame++) expect(s.tick()).toMatchObject({ x: 0, y: 0 });
      expect(s.player).toMatchObject(at);
      expect(['Pulling', 'Farming', 'Waiting for respawn']).toContain(s.farm.state().status);
    });
  });

  it('stays at a camp while its group has enemies up nearby, for up to a stint, before its turn passes', () => {
    const s = farmWith();
    // Health close by, speed far off; both on Farm.
    for (let i = 0; i < 4; i++) s.add('Bramble', 600 + i * 40, 500);
    s.add('Needle', 3_000, 3_000);
    s.farm.start([health, speed]);
    expect(s.farm.state().selected).toBe(health);
    // Past the old 20 s turn the camp nearby is still farmed.
    for (let second = 0; second < 30; second++) s.tick(1);
    expect(s.farm.state().selected).toBe(health);
    for (let second = 0; second < CAMP_STINT_SECONDS; second++) s.tick(1);
    expect(s.farm.state().selected).toBe(speed);
  });
});
