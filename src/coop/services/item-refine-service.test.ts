import { expect, it, vi } from "vitest";
import { createItemRefineRows } from "./item-refine-service";

const at = (ms: number) => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n });

function fakeConnection() {
  const handlers: Array<() => void> = [];
  const applied: Array<() => void> = [];
  const rows = { first: [] as any[], copies: [] as any[], ores: [] as any[], result: [] as any[] };
  const view = (list: unknown[]) => ({
    iter: () => list[Symbol.iterator](),
    onInsert: (handler: () => void) => handlers.push(handler),
    onUpdate: (handler: () => void) => handlers.push(handler),
    onDelete: (handler: () => void) => handlers.push(handler),
  });
  const reducers = { refineItem: vi.fn(async () => {}) };
  const connection = {
    isActive: true,
    db: { myItemRefines: view(rows.first), myCopyRefines: view(rows.copies), myOres: view(rows.ores), myRefineResult: view(rows.result) },
    reducers,
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe: vi.fn() }),
  };
  return { connection: connection as never, rows, reducers, settle: () => applied.forEach(callback => callback()), fire: () => handlers.forEach(handler => handler()) };
}

it("serves each copy's level, the ores held, and the last try", () => {
  const fake = fakeConnection(), service = createItemRefineRows(vi.fn());
  fake.rows.first.push({ itemId: "ion_bow", level: 7 });
  fake.rows.copies.push({ copyId: 4n, itemId: "ion_bow", level: 3 });
  fake.rows.ores.push({ oreId: "adamant_ore", count: 12 }, { oreId: "not_an_ore", count: 9 });
  fake.rows.result.push({ itemId: "ion_bow", copyId: 0n, fromLevel: 6, toLevel: 7, succeeded: true, attempt: 3, triedAt: at(5_000) });
  service.watch(fake.connection, () => true);
  fake.settle();
  expect([service.api.itemRefine("ion_bow"), service.api.itemRefine("ion_bow", 4n), service.api.itemRefine("sky_bow")]).toEqual([7, 3, 0]);
  expect(service.api.ores()).toEqual({ adamant_ore: 12 });
  expect(service.api.lastRefineResult()).toMatchObject({ toLevel: 7, succeeded: true, attempt: 3, triedAtMs: 5_000 });
});

it("announces a new try, never the standing one found on connect", () => {
  const fake = fakeConnection(), service = createItemRefineRows(vi.fn());
  const heard = vi.fn();
  service.api.setOnRefineResult(heard);
  fake.rows.result.push({ itemId: "ion_bow", copyId: 0n, fromLevel: 4, toLevel: 3, succeeded: false, attempt: 1, triedAt: at(1) });
  service.watch(fake.connection, () => true);
  fake.settle();
  expect(heard).not.toHaveBeenCalled();
  fake.rows.result[0] = { ...fake.rows.result[0], fromLevel: 3, toLevel: 4, succeeded: true, attempt: 2 };
  fake.fire();
  expect(heard).toHaveBeenCalledTimes(1);
  expect(heard.mock.calls[0][0]).toMatchObject({ toLevel: 4, succeeded: true });
});

it("sends a try with the level the player saw, and reports the server's refusal", async () => {
  const fake = fakeConnection(), service = createItemRefineRows(vi.fn());
  service.watch(fake.connection, () => true);
  await expect(service.api.refineItem("ion_bow", 0n, 4)).resolves.toEqual({ ok: true });
  expect(fake.reducers.refineItem).toHaveBeenCalledWith({ itemId: "ion_bow", copyId: 0n, expectedLevel: 4 });
  fake.reducers.refineItem.mockRejectedValueOnce(new Error("You need 1 Adamant Ore."));
  await expect(service.api.refineItem("ion_bow", 0n, 4)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Adamant Ore") });
});

it("does nothing without a current connection", async () => {
  const service = createItemRefineRows(vi.fn());
  await expect(service.api.refineItem("ion_bow", 0n, 0)).resolves.toEqual({ ok: false, error: "NOT CONNECTED" });
});

it("gives stats an item's slot tier with its first copy's refine", () => {
  const fake = fakeConnection(), service = createItemRefineRows(vi.fn(), itemId => (itemId === "ion_bow" ? 12 : 0));
  fake.rows.first.push({ itemId: "ion_bow", level: 5 });
  fake.rows.copies.push({ copyId: 4n, itemId: "ion_bow", level: 9 });
  service.watch(fake.connection, () => true);
  fake.settle();
  expect(service.api.itemLevel("ion_bow")).toEqual({ tier: 12, refine: 5 });
  expect(service.api.itemLevel("sky_bow")).toEqual({ tier: 0, refine: 0 });
});
