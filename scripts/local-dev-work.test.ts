import { afterEach, expect, it, vi } from 'vitest';
import { createLocalDevWork, localChangeKind } from './local-dev-work.mjs';

afterEach(() => vi.useRealTimers());

it('separates live CSS from client rebuilds and local server changes', () => {
  expect(localChangeKind('public/assets/wildstat/game.css')).toBe('style');
  expect(localChangeKind('public/index.html')).toBe('page');
  expect(localChangeKind('public/assets/wildstat/icon.png')).toBe('page');
  expect(localChangeKind('src/ui/game-shell.ts')).toBe('client');
  expect(localChangeKind('config/vite.game.config.ts')).toBe('client');
  expect(localChangeKind('shared/rules.ts')).toBe('server');
  expect(localChangeKind('spacetimedb/src/index.ts')).toBe('server');
  expect(localChangeKind('spacetimedb/dist/bundle.js')).toBeNull();
  expect(localChangeKind('src/ui/profile.test.ts')).toBeNull();
  expect(localChangeKind('docs/development.md')).toBeNull();
});

it('coalesces an edit burst and queues edits made during a build without overlapping', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const run = vi.fn((_changes: Set<string>) => new Promise<void>(resolve => { finish = resolve; }));
  const work = createLocalDevWork({ run, reportError: vi.fn() });
  work.add('client'); work.add('server'); work.add('client');
  await vi.advanceTimersByTimeAsync(250);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][0]).toEqual(new Set(['client', 'server']));
  work.add('client');
  await vi.advanceTimersByTimeAsync(500);
  expect(run).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(250);
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1][0]).toEqual(new Set(['client']));
  work.close(); finish();
});

it('reports failures once and accepts the next correction without restarting', async () => {
  vi.useFakeTimers();
  const run = vi.fn().mockRejectedValueOnce(new Error('syntax')).mockResolvedValue(undefined);
  const reportError = vi.fn();
  const work = createLocalDevWork({ run, reportError });
  work.add('client'); await vi.advanceTimersByTimeAsync(250);
  expect(reportError).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(run).toHaveBeenCalledTimes(1);
  work.add('client'); await vi.advanceTimersByTimeAsync(250);
  expect(run).toHaveBeenCalledTimes(2);
  work.close();
});

it('cancels queued changes when the terminal is stopped', async () => {
  vi.useFakeTimers();
  const run = vi.fn();
  const work = createLocalDevWork({ run, reportError: vi.fn() });
  work.add('server'); work.close();
  await vi.advanceTimersByTimeAsync(500);
  expect(run).not.toHaveBeenCalled();
});

it('waits for an active build before allowing workspace cleanup', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const work = createLocalDevWork({ run, reportError: vi.fn() });
  work.add('client');
  await vi.advanceTimersByTimeAsync(250);
  const cleaned = vi.fn();
  const stopping = work.close().then(cleaned);
  await Promise.resolve();
  expect(cleaned).not.toHaveBeenCalled();
  finish();
  await stopping;
  expect(cleaned).toHaveBeenCalledOnce();
});
