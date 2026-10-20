import { expect, it, vi } from "vitest";
import { createWoodcuttingRows } from "./woodcutting-service";
import { WOOD_TREE_NODES, WOODCUTTING_LOGS, woodcuttingGain } from "../../../shared/woodcutting";
import { GATHER_FLUSH_MS } from "../../../shared/gather-batch";

const at = (ms: number) => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n });

function fakeConnection() {
  const handlers: Array<() => void> = [];
  const applied: Array<() => void> = [];
  const rows = { woodcutting: [] as any[], felled: [] as any[] };
  const view = (list: unknown[]) => ({
    iter: () => list[Symbol.iterator](),
    onInsert: (handler: () => void) => handlers.push(handler),
    onUpdate: (handler: () => void) => handlers.push(handler),
    onDelete: (handler: () => void) => handlers.push(handler),
  });
  const reducers = {
    // The server's side: takes every fall but the ones listed, writes their rows, then answers.
    reportChopping: vi.fn(async (report: { chops: { treeId: number; atMs: bigint }[] }) => {
      const kept = report.chops.filter(entry => !refuse.has(entry.treeId));
      if (!kept.length) return;
      const row = rows.woodcutting[0] ?? woodcuttingRow({ woodcutting: 0, treesChopped: 0 });
      rows.woodcutting[0] = { ...row, treesChopped: row.treesChopped + kept.length };
      for (const entry of kept) rows.felled.push({ treeId: entry.treeId, choppedAt: at(Number(entry.atMs)) });
      handlers.forEach(handler => handler());
    }),
  };
  const refuse = new Set<number>();
  const connection = {
    isActive: true,
    db: { myWoodcutting: view(rows.woodcutting), myChoppedTrees: view(rows.felled) },
    reducers,
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe: vi.fn() }),
  };
  return { connection: connection as never, rows, reducers, refuse, settle: () => applied.forEach(callback => callback()), fire: () => handlers.forEach(handler => handler()) };
}
const woodcuttingRow = (overrides: Record<string, unknown> = {}) => ({
  woodcutting: 30, treesChopped: 3, lastTreeId: 7, hatchetAt: at(1), lastChopAt: at(2), ...overrides,
});

it("serves Woodcutting and each stump's fell time, Woodcutting 0 before the first tree", () => {
  const fake = fakeConnection(), service = createWoodcuttingRows(vi.fn());
  service.watch(fake.connection, () => true);
  fake.settle();
  expect(service.api.woodcutting()).toBe(0);
  fake.rows.woodcutting.push(woodcuttingRow());
  fake.rows.felled.push({ treeId: 7, choppedAt: at(5_000) });
  fake.fire();
  expect(service.api.woodcutting()).toBe(30);
  expect([service.api.choppedTreeAt(7), service.api.choppedTreeAt(8)]).toEqual([5_000, null]);
});

const pines = WOOD_TREE_NODES.filter(tree => tree.kind === "pine");

it("counts a queued fall at once and sends every fall in one report after a while", async () => {
  vi.useFakeTimers();
  try {
    const fake = fakeConnection(), service = createWoodcuttingRows(vi.fn()), rejected = vi.fn();
    service.watch(fake.connection, () => true);
    fake.settle();
    service.api.setOnWoodcuttingRejected(rejected);
    service.api.queueTreeChop(pines[0].id, 4_000);
    service.api.queueTreeChop(pines[1].id, 12_000);
    expect([service.api.choppedTreeAt(pines[1].id), service.api.woodcutting(), service.pendingOres()])
      .toEqual([12_000, 2 * woodcuttingGain(pines[0]), { pine_log: 2 * WOODCUTTING_LOGS }]);
    expect(fake.reducers.reportChopping).not.toHaveBeenCalled();
    fake.refuse.add(pines[1].id);
    await vi.advanceTimersByTimeAsync(GATHER_FLUSH_MS);
    expect(fake.reducers.reportChopping).toHaveBeenCalledExactlyOnceWith({ chops: [{ treeId: pines[0].id, atMs: 4_000n }, { treeId: pines[1].id, atMs: 12_000n }] });
    // The fall the server left out stands again; the other is the server's stump now.
    expect([service.api.choppedTreeAt(pines[0].id), service.api.choppedTreeAt(pines[1].id), service.pendingOres()]).toEqual([4_000, null, {}]);
    expect(rejected).toHaveBeenCalledExactlyOnceWith("A tree stands again: that fall was not counted.");
    service.api.queueTreeChop(pines[2].id, 20_000);
    service.api.flushWoodcutting();
    expect(fake.reducers.reportChopping).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it("says so when there is no connection to report to", () => {
  const service = createWoodcuttingRows(vi.fn()), rejected = vi.fn();
  service.api.setOnWoodcuttingRejected(rejected);
  service.api.queueTreeChop(pines[0].id, 4_000);
  service.api.flushWoodcutting();
  expect(rejected).toHaveBeenCalledWith("Not Connected");
  expect(service.api.choppedTreeAt(pines[0].id)).toBeNull();
});

it("forgets unsent falls on a new connection", () => {
  const service = createWoodcuttingRows(vi.fn());
  const fake = fakeConnection();
  service.watch(fake.connection, () => false);
  fake.rows.woodcutting.push(woodcuttingRow());
  fake.settle();
  expect(service.api.woodcutting()).toBe(0);
  service.api.queueTreeChop(pines[0].id, 4_000);
  service.watch(fakeConnection().connection, () => true);
  expect(service.api.choppedTreeAt(pines[0].id)).toBeNull();
});
