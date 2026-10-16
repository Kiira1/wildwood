import { it, expect, vi, afterEach } from 'vitest';
import { createMapBalanceLoader } from './map-balance-loader';
import { defaultBalanceSettings, resolveMapBalance } from '../../../shared/map-balance';
import { runtimeMapBalance, installMapBalance } from '../../../shared/map-balance-runtime';
afterEach(() => { installMapBalance(null); vi.useRealTimers(); });
it('coalesces loading checks and discards replies for a map that was left', async () => {
  let map = 'home_exterior';
  let resolve!: (value: ReturnType<typeof resolveMapBalance>) => void;
  const fetch = vi.fn(() => new Promise<ReturnType<typeof resolveMapBalance>>(r => { resolve = r; }));
  const loader = createMapBalanceLoader({ identity: () => 'alice', mapId: () => map, fetch, changed: vi.fn() });
  const work = loader.ensure(map); void loader.ensure(map); void loader.ensure(map);
  expect(fetch).toHaveBeenCalledTimes(1);
  map = 'tutorial_forest'; resolve(resolveMapBalance('home_exterior', defaultBalanceSettings(), 1)); await work;
  expect(loader.ready('home_exterior')).toBe(false);
  expect(runtimeMapBalance('home_exterior')).toBeNull();
});
it('bounds a hanging request, retries, and caches until a new map visit', async () => {
  vi.useFakeTimers(); let call = 0;
  const snapshot = resolveMapBalance('home_exterior', defaultBalanceSettings(), 1);
  const fetch = vi.fn(() => ++call === 1 ? new Promise<typeof snapshot>(() => {}) : Promise.resolve(snapshot));
  const loader = createMapBalanceLoader({ identity: () => 'alice', mapId: () => 'home_exterior', fetch, changed: vi.fn() });
  const promise = loader.ensure('home_exterior'); const assertion = expect(promise).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(12000); await assertion;
  await vi.advanceTimersByTimeAsync(1500); await loader.ensure('home_exterior');
  expect(loader.ready('home_exterior')).toBe(true);
  await loader.ensure('home_exterior'); expect(fetch).toHaveBeenCalledTimes(2);
  loader.reset(); await loader.ensure('home_exterior'); expect(fetch).toHaveBeenCalledTimes(3);
});
it('takes a reply that lands after the timeout while the player is still on that map', async () => {
  vi.useFakeTimers();
  const snapshot = resolveMapBalance('home_exterior', defaultBalanceSettings(), 1);
  let answer!: (value: typeof snapshot) => void;
  // The server answers every request, just slower than the 12 s budget.
  const fetch = vi.fn(() => new Promise<typeof snapshot>(r => { answer = r; }));
  const changed = vi.fn();
  const loader = createMapBalanceLoader({ identity: () => 'alice', mapId: () => 'home_exterior', fetch, changed });
  const first = loader.ensure('home_exterior'); const timedOut = expect(first).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(12000); await timedOut;
  // The first reply arrives at 13 s: the world no longer waits for a second try.
  answer(snapshot); await vi.advanceTimersByTimeAsync(1000);
  expect(loader.ready('home_exterior')).toBe(true);
  expect(changed).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('ignores a late reply once the player has left that map', async () => {
  vi.useFakeTimers();
  let map = 'home_exterior';
  const snapshot = resolveMapBalance('home_exterior', defaultBalanceSettings(), 1);
  let answer!: (value: typeof snapshot) => void;
  const loader = createMapBalanceLoader({ identity: () => 'alice', mapId: () => map, fetch: () => new Promise<typeof snapshot>(r => { answer = r; }), changed: vi.fn() });
  const first = loader.ensure('home_exterior'); const timedOut = expect(first).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(12000); await timedOut;
  map = 'tutorial_forest'; loader.reset();
  answer(snapshot); await vi.advanceTimersByTimeAsync(1000);
  expect(loader.ready('home_exterior')).toBe(false);
  expect(runtimeMapBalance('home_exterior')).toBeNull();
});
it('blocks hits on the curve armor rule, keeping small hits fractional', async () => {
  const { applyMapBalance } = await import('./map-balance-loader');
  const { damageAfterArmor } = await import('../combat');
  // The live balance does not carry the rule; a snapshot that does switches it on.
  const live = resolveMapBalance('beginner_desert', defaultBalanceSettings(), 1);
  applyMapBalance({ ...live, rules: { ...live.rules, ARMOR_CURVE: 1 } });
  expect(damageAfterArmor(1_000, 1_000)).toBeCloseTo(729);   // 1,000 armor: .9³ gets through
  expect(damageAfterArmor(.5, 10)).toBeCloseTo(.45);
});
