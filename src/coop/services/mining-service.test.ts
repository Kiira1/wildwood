import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMiningRows } from "./mining-service";
import { MINING_NODES, miningGain } from "../../../shared/mining";
import { GATHER_FLUSH_MS, GATHER_QUEUE_CAP } from "../../../shared/gather-batch";

const at = (ms: number) => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n });
const rock = (ore: string, kind: string, skip = 0) => MINING_NODES.filter(node => node.ore === ore && node.kind === kind)[skip]!;
const copper = rock("copper_ore", "small"), copperTwo = rock("copper_ore", "small", 1), mysterious = rock("copper_ore", "mysterious");
type Report = { breaks: { nodeId: number; atMs: bigint }[] };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

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
  const fire = () => handlers.forEach(handler => handler());
  /** The server's side of a report: takes the breaks `take` keeps, writes their rows, then answers, as a transaction does. */
  const serve = (take: (nodeId: number) => boolean = () => true) => async (report: Report) => {
    const kept = report.breaks.filter(entry => take(entry.nodeId));
    if (kept.length) {
      const row = rows.mining[0] ?? (rows.mining[0] = miningRow({ mining: 0, rocksBroken: 0 }));
      rows.mining[0] = { ...row, rocksBroken: row.rocksBroken + kept.length, mining: row.mining + kept.length };
      for (const entry of kept) rows.broken.push({ nodeId: entry.nodeId, brokenAt: at(Number(entry.atMs)) });
      fire();
    }
  };
  const reducers = {
    reportMining: vi.fn(serve()),
    buyGradeGear: vi.fn(async (_args: { itemId: string; expectedPrice: bigint }) => {}),
  };
  const connection = {
    isActive: true,
    db: { myMining: view(rows.mining), myMinedNodes: view(rows.broken) },
    reducers,
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe: vi.fn() }),
  };
  return { connection: connection as never, rows, reducers, serve, settle: () => applied.forEach(callback => callback()), fire };
}
const miningRow = (overrides: Record<string, unknown> = {}) => ({
  mining: 40, rocksBroken: 3, lastNodeId: 7, lastStarshard: false, pickaxeAt: at(1), lastBreakAt: at(2), ...overrides,
});
function connected() {
  const fake = fakeConnection(), notify = vi.fn(), service = createMiningRows(notify), rejected = vi.fn();
  service.watch(fake.connection, () => true);
  fake.settle();
  service.api.setOnMiningRejected(rejected);
  return { fake, service, rejected, notify };
}

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

it("counts a queued break at once: the rock bare, its Mining and ore, before any report goes out", () => {
  const { fake, service, notify } = connected();
  service.api.queueMiningBreak(copper.id, 9_000);
  service.api.queueMiningBreak(mysterious.id, 21_000);
  expect(fake.reducers.reportMining).not.toHaveBeenCalled();
  expect([service.api.minedNodeAt(copper.id), service.api.minedNodeAt(mysterious.id)]).toEqual([9_000, 21_000]);
  expect(service.api.mining()).toBe(miningGain(copper) + miningGain(mysterious));
  expect(service.pendingOres()).toEqual({ copper_ore: 3, starshard: 1 });
  expect(notify).toHaveBeenCalled();
});

it("sends one report for every break once the first has waited long enough", async () => {
  const { fake, service } = connected();
  service.api.queueMiningBreak(copper.id, 9_000);
  await vi.advanceTimersByTimeAsync(GATHER_FLUSH_MS / 2);
  service.api.queueMiningBreak(copperTwo.id, 14_000);
  await vi.advanceTimersByTimeAsync(GATHER_FLUSH_MS / 2 - 1);
  expect(fake.reducers.reportMining).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fake.reducers.reportMining).toHaveBeenCalledExactlyOnceWith({ breaks: [{ nodeId: copper.id, atMs: 9_000n }, { nodeId: copperTwo.id, atMs: 14_000n }] });
  // Taken: the server's rows hold them now, and nothing is counted twice.
  expect([service.api.mining(), service.api.minedNodeAt(copperTwo.id), service.pendingOres()]).toEqual([2, 14_000, {}]);
  await vi.advanceTimersByTimeAsync(GATHER_FLUSH_MS * 2);
  expect(fake.reducers.reportMining).toHaveBeenCalledTimes(1);
});

it("sends at once when the queue is full, and whenever asked to, never an empty report", async () => {
  const { fake, service } = connected();
  for (let index = 0; index < GATHER_QUEUE_CAP; index++) service.api.queueMiningBreak(MINING_NODES[index].id, 1_000 + index);
  expect(fake.reducers.reportMining).toHaveBeenCalledTimes(1);
  expect((fake.reducers.reportMining.mock.calls[0][0] as Report).breaks).toHaveLength(GATHER_QUEUE_CAP);
  service.api.flushMining();
  expect(fake.reducers.reportMining).toHaveBeenCalledTimes(1);
  service.api.queueMiningBreak(copper.id, 90_000);
  service.api.flushMining();
  expect(fake.reducers.reportMining).toHaveBeenCalledTimes(2);
});

it("stands a rock the server left out of its report again, and says how many did not count", async () => {
  const { fake, service, rejected } = connected();
  fake.reducers.reportMining.mockImplementation(fake.serve(nodeId => nodeId !== copperTwo.id));
  service.api.queueMiningBreak(copper.id, 9_000);
  service.api.queueMiningBreak(copperTwo.id, 14_000);
  expect(service.api.minedNodeAt(copperTwo.id)).toBe(14_000);
  service.api.flushMining();
  await vi.advanceTimersByTimeAsync(0);
  expect([service.api.minedNodeAt(copper.id), service.api.minedNodeAt(copperTwo.id)]).toEqual([9_000, null]);
  expect(service.api.mining()).toBe(1);
  expect(rejected).toHaveBeenCalledExactlyOnceWith("A broken rock did not count.");
  // A later report that is taken whole says nothing.
  fake.reducers.reportMining.mockImplementation(fake.serve());
  service.api.queueMiningBreak(copperTwo.id, 30_000);
  service.api.flushMining();
  await vi.advanceTimersByTimeAsync(0);
  expect(rejected).toHaveBeenCalledTimes(1);
});

it("stands every rock in a refused or unanswered report again, with the reason", async () => {
  const { fake, service, rejected } = connected();
  fake.reducers.reportMining.mockRejectedValueOnce(new Error("Walk up to the rock first."));
  service.api.queueMiningBreak(copper.id, 9_000);
  service.api.flushMining();
  await vi.advanceTimersByTimeAsync(0);
  expect(service.api.minedNodeAt(copper.id)).toBeNull();
  expect(rejected).toHaveBeenCalledWith(expect.stringContaining("Walk up to the rock first."));
  // A dropped connection never answers: the deadline lets the rocks go.
  fake.reducers.reportMining.mockImplementation(() => new Promise<void>(() => {}));
  service.api.queueMiningBreak(copperTwo.id, 12_000);
  service.api.flushMining();
  expect(service.api.minedNodeAt(copperTwo.id)).toBe(12_000);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(service.api.minedNodeAt(copperTwo.id)).toBeNull();
  expect(rejected).toHaveBeenLastCalledWith("Request timed out. Try again.");
});

it("lets unsent breaks go on a new connection, and ignores the old one's replies", async () => {
  const { fake, service, rejected } = connected();
  let answer!: () => void;
  fake.reducers.reportMining.mockImplementationOnce(() => new Promise<void>(resolve => { answer = resolve; }));
  service.api.queueMiningBreak(copper.id, 9_000);
  service.api.flushMining();
  service.api.queueMiningBreak(copperTwo.id, 14_000);
  const next = fakeConnection();
  service.watch(next.connection, () => true);
  next.settle();
  expect([service.api.minedNodeAt(copper.id), service.api.minedNodeAt(copperTwo.id), service.api.mining()]).toEqual([null, null, 0]);
  answer();
  await vi.advanceTimersByTimeAsync(GATHER_FLUSH_MS);
  expect(rejected).not.toHaveBeenCalled();
  expect(next.reducers.reportMining).not.toHaveBeenCalled();
});

it("says so when there is no connection to report to", () => {
  const service = createMiningRows(vi.fn()), rejected = vi.fn();
  service.api.setOnMiningRejected(rejected);
  service.api.queueMiningBreak(copper.id, 9_000);
  service.api.flushMining();
  expect(rejected).toHaveBeenCalledWith("Not Connected");
  expect(service.api.minedNodeAt(copper.id)).toBeNull();
});

it("buys from the Smith and reports the server's refusal", async () => {
  vi.useRealTimers();
  const { fake, service } = connected();
  await expect(service.api.buyGradeGear("rare_bow", 5_000)).resolves.toEqual({ ok: true });
  expect(fake.reducers.buyGradeGear).toHaveBeenCalledWith({ itemId: "rare_bow", expectedPrice: 5_000n });
  fake.reducers.buyGradeGear.mockRejectedValueOnce(new Error("Not enough gold."));
  await expect(service.api.buyGradeGear("rare_bow", 5_000)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("gold") });
  const offline = createMiningRows(vi.fn());
  await expect(offline.api.buyGradeGear("rare_bow", 5_000)).resolves.toEqual({ ok: false, error: "NOT CONNECTED" });
});
