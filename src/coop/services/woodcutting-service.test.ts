import { expect, it, vi } from "vitest";
import { createWoodcuttingRows } from "./woodcutting-service";

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
  const reducers = { chopTree: vi.fn(async () => {}), claimHatchet: vi.fn(async () => {}) };
  const connection = {
    isActive: true,
    db: { myWoodcutting: view(rows.woodcutting), myChoppedTrees: view(rows.felled) },
    reducers,
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe: vi.fn() }),
  };
  return { connection: connection as never, rows, reducers, settle: () => applied.forEach(callback => callback()), fire: () => handlers.forEach(handler => handler()) };
}
const woodcuttingRow = (overrides: Record<string, unknown> = {}) => ({
  woodcutting: 30, treesChopped: 3, lastTreeId: 7, hatchetAt: at(1), lastChopAt: at(2), ...overrides,
});

it("serves Woodcutting, the hatchet and each stump's fell time", () => {
  const fake = fakeConnection(), service = createWoodcuttingRows(vi.fn());
  service.watch(fake.connection, () => true);
  fake.settle();
  expect([service.api.woodcutting(), service.api.hasHatchet()]).toEqual([0, false]);
  fake.rows.woodcutting.push(woodcuttingRow());
  fake.rows.felled.push({ treeId: 7, choppedAt: at(5_000) });
  fake.fire();
  expect([service.api.woodcutting(), service.api.hasHatchet()]).toEqual([30, true]);
  expect([service.api.choppedTreeAt(7), service.api.choppedTreeAt(8)]).toEqual([5_000, null]);
});

it("announces each new chop, never the standing one found on connect", () => {
  const fake = fakeConnection(), service = createWoodcuttingRows(vi.fn());
  const heard = vi.fn();
  service.api.setOnTreeChopped(heard);
  fake.rows.woodcutting.push(woodcuttingRow());
  service.watch(fake.connection, () => true);
  fake.settle();
  expect(heard).not.toHaveBeenCalled();
  fake.rows.woodcutting[0] = woodcuttingRow({ treesChopped: 4, lastTreeId: 9 });
  fake.fire();
  expect(heard).toHaveBeenCalledTimes(1);
  expect(heard.mock.calls[0][0]).toEqual({ treeId: 9, treesChopped: 4 });
});

it("sends a chop and the hatchet claim, and reports the server's refusal", async () => {
  const fake = fakeConnection(), service = createWoodcuttingRows(vi.fn());
  service.watch(fake.connection, () => true);
  await expect(service.api.chopTree(12)).resolves.toEqual({ ok: true });
  expect(fake.reducers.chopTree).toHaveBeenCalledWith({ treeId: 12 });
  await expect(service.api.claimHatchet()).resolves.toEqual({ ok: true });
  fake.reducers.chopTree.mockRejectedValueOnce(new Error("That tree is still growing back."));
  await expect(service.api.chopTree(12)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("growing back") });
});

it("does nothing without a current connection", async () => {
  const service = createWoodcuttingRows(vi.fn());
  await expect(service.api.chopTree(1)).resolves.toEqual({ ok: false, error: "NOT CONNECTED" });
  const fake = fakeConnection();
  service.watch(fake.connection, () => false);
  fake.rows.woodcutting.push(woodcuttingRow());
  fake.settle();
  expect(service.api.hasHatchet()).toBe(false);
});
