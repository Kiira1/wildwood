import { expect, it, vi } from "vitest";
import { createRegularEnemyLootQueue, type EnemyLootRequest } from "./regular-enemy-loot-queue";
function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } as unknown as Storage;
  let identity = "alice";
  const send = vi.fn(async (_request: EnemyLootRequest) => true);
  const options = { identity: () => identity, tabId: () => "tab", storage, send };
  const queue = createRegularEnemyLootQueue(options);
  return { queue, send, options, identity: (value: string) => { identity = value; } };
}
it("combines kills, keeps source maps separate, and bounds batches", async () => {
  const f = fixture();
  for (let i = 0; i < 25; i++) f.queue.record("cloudspire");
  f.queue.record("moonfen");
  expect(f.send).not.toHaveBeenCalled();
  await f.queue.flush();
  expect(f.send.mock.calls.map(([r]) => [r.mapId, r.count, r.sequence])).toEqual([["cloudspire", 25, 1n], ["moonfen", 1, 2n]]);
  for (let i = 0; i < 205; i++) f.queue.record("cloudspire");
  await f.queue.flush();
  expect(f.send.mock.calls.slice(2).map(([r]) => r.count)).toEqual([100, 100, 5]);
});
it("persists an unacknowledged batch and never adds kills to a retry", async () => {
  const f = fixture(); f.send.mockResolvedValue(false);
  f.queue.record("water_reach");
  expect(await f.queue.flush()).toBe(false);
  const original = { ...f.send.mock.calls[0][0] };
  f.queue.record("water_reach");
  const reload = createRegularEnemyLootQueue(f.options);
  reload.begin(); f.send.mockResolvedValue(true);
  await reload.flush();
  expect(f.send.mock.calls[1][0]).toEqual(original);
  expect(f.send.mock.calls[2][0]).toMatchObject({ count: 1, sequence: 2n });
});
it("does not let an old identity's acknowledgement consume another player's queue", async () => {
  const f = fixture();
  let finish!: (value: boolean) => void;
  f.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  f.queue.record("water_reach"); const old = f.queue.flush();
  f.identity("bob"); f.queue.begin(); f.queue.record("moonfen");
  finish(true); expect(await old).toBe(false);
  await f.queue.flush();
  expect(f.send.mock.calls[1][0]).toMatchObject({ mapId: "moonfen", count: 1, sequence: 1n });
});
it("bounds a stalled acknowledgement and retries its unchanged sequence", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    f.send.mockImplementationOnce(() => new Promise(() => {}));
    f.queue.record("cloudspire"); const pending = f.queue.flush();
    await vi.advanceTimersByTimeAsync(4_001);
    expect(await pending).toBe(false);
    await f.queue.flush();
    expect(f.send.mock.calls[1][0]).toEqual(f.send.mock.calls[0][0]);
  } finally { vi.useRealTimers(); }
});
