import { expect, it, vi } from "vitest";
import { createMiningRows } from "./mining-service";

const at = (ms: number) => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n });

function fakeConnection() {
  const handlers: Array<() => void> = [];
  const applied: Array<() => void> = [];
  const rows = { mining: [] as any[], broken: [] as any[] };
  const view = (list: unknown[]) => ({
    iter: () => list[Symbol.iterator](),
    onInsert: (handler: () => void) => handlers.push(handler),
    onUpdate: (handler: () => void) => handlers.push(handler),
    onDelete: (handler: () => void) => handlers.push(handler),
  });
  const reducers = { mineNode: vi.fn(async () => {}), buyGradeGear: vi.fn(async (_args: { itemId: string; expectedPrice: bigint }) => {}) };
  const connection = {
    isActive: true,
    db: { myMining: view(rows.mining), myMinedNodes: view(rows.broken) },
    reducers,
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe: vi.fn() }),
  };
  return { connection: connection as never, rows, reducers, settle: () => applied.forEach(callback => callback()), fire: () => handlers.forEach(handler => handler()) };
}
const miningRow = (overrides: Record<string, unknown> = {}) => ({
  mining: 40, rocksBroken: 3, lastNodeId: 7, lastStarshard: false, pickaxeAt: at(1), lastBreakAt: at(2), ...overrides,
});

it("serves Mining and each bare rock's break time, Mining 0 before the first rock", () => {
  const fake = fakeConnection(), service = createMiningRows(vi.fn());
  service.watch(fake.connection, () => true);
  fake.settle();
  expect(service.api.mining()).toBe(0);
  fake.rows.mining.push(miningRow());
  fake.rows.broken.push({ nodeId: 7, brokenAt: at(5_000) });
  fake.fire();
  expect(service.api.mining()).toBe(40);
  expect([service.api.minedNodeAt(7), service.api.minedNodeAt(8)]).toEqual([5_000, null]);
});

it("announces each new break, never the standing one found on connect", () => {
  const fake = fakeConnection(), service = createMiningRows(vi.fn());
  const heard = vi.fn();
  service.api.setOnMiningBreak(heard);
  fake.rows.mining.push(miningRow());
  service.watch(fake.connection, () => true);
  fake.settle();
  expect(heard).not.toHaveBeenCalled();
  fake.rows.mining[0] = miningRow({ rocksBroken: 4, lastNodeId: 9, lastStarshard: true });
  fake.fire();
  expect(heard).toHaveBeenCalledTimes(1);
  expect(heard.mock.calls[0][0]).toEqual({ nodeId: 9, starshard: true, rocksBroken: 4 });
  // A row with nothing broken yet (an old pickaxe claim) is not a break.
  const fresh = fakeConnection(), other = createMiningRows(vi.fn()), none = vi.fn();
  other.api.setOnMiningBreak(none);
  other.watch(fresh.connection, () => true);
  fresh.settle();
  fresh.rows.mining.push(miningRow({ rocksBroken: 0 }));
  fresh.fire();
  expect(none).not.toHaveBeenCalled();
});

it("sends a break and a purchase, and reports the server's refusal", async () => {
  const fake = fakeConnection(), service = createMiningRows(vi.fn());
  service.watch(fake.connection, () => true);
  await expect(service.api.mineNode(12)).resolves.toEqual({ ok: true });
  expect(fake.reducers.mineNode).toHaveBeenCalledWith({ nodeId: 12 });
  await expect(service.api.buyGradeGear("rare_bow", 5_000)).resolves.toEqual({ ok: true });
  expect(fake.reducers.buyGradeGear).toHaveBeenCalledWith({ itemId: "rare_bow", expectedPrice: 5_000n });
  fake.reducers.mineNode.mockRejectedValueOnce(new Error("That rock is still growing back."));
  await expect(service.api.mineNode(12)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("growing back") });
});

it("does nothing without a current connection", async () => {
  const service = createMiningRows(vi.fn());
  await expect(service.api.mineNode(1)).resolves.toEqual({ ok: false, error: "NOT CONNECTED" });
  const fake = fakeConnection();
  service.watch(fake.connection, () => false);
  fake.rows.mining.push(miningRow());
  fake.settle();
  expect(service.api.mining()).toBe(0);
});

it("gives up on a break when the server never answers, so mining is not left waiting", async () => {
  vi.useFakeTimers();
  try {
    const fake = fakeConnection(), service = createMiningRows(vi.fn());
    service.watch(fake.connection, () => true);
    fake.settle();
    // A dropped connection never settles the call.
    fake.reducers.mineNode.mockImplementation(() => new Promise<void>(() => {}));
    const broke = service.api.mineNode(3);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(broke).resolves.toEqual({ ok: false, error: "Request timed out. Try again." });
  } finally { vi.useRealTimers(); }
});
