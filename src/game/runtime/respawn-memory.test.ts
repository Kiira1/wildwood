import { expect, it, vi } from 'vitest';
import { createRespawnMemory } from './respawn-memory';
import { createPersonalBosses } from './personal-bosses';
import { createEnemyLifecycle } from './enemy-lifecycle';
import type { EnemyState } from './types';
import type { SpawnSite } from '../world';

function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  let now = 1_000, identity = 'alice';
  return { storage, now: () => now, advance: (ms: number) => { now += ms; },
    identity: () => identity, account: (value: string) => { identity = value; },
    memory: () => createRespawnMemory(storage, () => identity, () => now) };
}
it.each(['tutorial_forest', 'endless_40'])('keeps defeated %s dead across repeated refreshes, without duplicating its reward', mapId => {
  const f = fixture(), defeated = vi.fn();
  const create = () => createPersonalBosses({ mapId: () => mapId, now: f.now, identity: f.identity,
    alive: () => true, defeated, respawns: f.memory() });
  let bosses = create(); bosses.hit(mapId, bosses.state(mapId)!.hp);
  const due = bosses.state(mapId)!.respawnAtMs;
  for (let i = 0; i < 12; i++) {
    f.advance(1_000); bosses = create();
    bosses.hit(mapId, 1e30);
    expect(bosses.state(mapId)!.alive).toBe(false);
    expect(bosses.state(mapId)!.respawnAtMs).toBe(due);
  }
  expect(defeated).toHaveBeenCalledTimes(1);
  f.advance(due - f.now());
  expect(create().state(mapId)!.alive).toBe(true);
});
it('restores a dead regular spawn into the new game clock and respawns it only when due', () => {
  const f = fixture(); f.memory().remember('enemy', 20_000); f.advance(3_000);
  const enemies: EnemyState[] = [];
  const site: SpawnSite = { id: 0, x: 10, y: 20, campName: 'Test', type: 'Bramble', leashRange: 300, alive: false, respawnAt: 0 };
  const memory = f.memory(); let gameTime = 0;
  const lifecycle = createEnemyLifecycle(enemies, [site], vi.fn(), { remaining: () => memory.remaining('enemy'), gameTime: () => gameTime });
  lifecycle.spawnFromSite(site);
  expect(enemies).toHaveLength(0); expect(site.respawnAt).toBe(17);
  gameTime = 16; f.advance(16_000); lifecycle.updateRespawns(gameTime); expect(enemies).toHaveLength(0);
  gameTime = 17; f.advance(1_000); lifecycle.updateRespawns(gameTime); expect(enemies).toHaveLength(1);
});
it('isolates characters and clears expired or reset deadlines', () => {
  const f = fixture(), memory = f.memory(); memory.remember('boss', 45_000);
  f.account('bob'); expect(memory.remaining('boss')).toBe(0);
  f.account('alice'); expect(memory.remaining('boss')).toBe(45_000);
  memory.clear(); expect(f.memory().remaining('boss')).toBe(0);
  memory.remember('boss', 45_000); f.advance(45_001); expect(f.memory().remaining('boss')).toBe(0);
});
it('ignores broken storage rather than preventing gameplay', () => {
  const memory = createRespawnMemory({ getItem: () => '{broken', setItem: () => { throw Error('full'); }, removeItem: () => {} }, () => 'alice');
  expect(memory.remaining('boss')).toBe(0);
  expect(() => memory.remember('boss', 45_000)).not.toThrow();
});
