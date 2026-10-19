import { expect, it, vi } from "vitest";
import { createCraftingRows } from "./crafting-service";
import { craftMaterialsKey, gradeCraftMaterials } from "../../../shared/grade-craft";

function fakeConnection(active = true) {
  const handlers: Array<() => void> = [];
  const applied: Array<() => void> = [];
  const rows: any[] = [];
  const subscribe = vi.fn();
  const craftGradeGear = vi.fn(async () => undefined);
  const connection = {
    isActive: active,
    db: { myCraftSkills: {
      iter: () => rows[Symbol.iterator](),
      onInsert: (handler: () => void) => handlers.push(handler),
      onUpdate: (handler: () => void) => handlers.push(handler),
      onDelete: (handler: () => void) => handlers.push(handler),
    } },
    reducers: { craftGradeGear },
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe }),
  };
  return { connection: connection as never, rows, subscribe, craftGradeGear, settle: () => applied.forEach(callback => callback()), fire: () => handlers.forEach(handler => handler()) };
}

it("serves each craft's experience, 0 for a craft with no row, and ignores unknown crafts", () => {
  const fake = fakeConnection(), notify = vi.fn(), service = createCraftingRows(notify);
  service.watch(fake.connection, () => true);
  expect(fake.subscribe).toHaveBeenCalledOnce();
  fake.settle();
  expect(service.api.craftSkills()).toEqual({ smithing: 0n, fletching: 0n, enchanting: 0n });
  fake.rows.push({ skill: "fletching", experience: 300n }, { skill: "cooking", experience: 5n });
  fake.fire();
  expect(service.api.craftSkills()).toEqual({ smithing: 0n, fletching: 300n, enchanting: 0n });
  expect(notify).toHaveBeenCalled();
});

it("ignores rows from a connection that is no longer current", () => {
  const fake = fakeConnection(), service = createCraftingRows(vi.fn());
  let current = true;
  service.watch(fake.connection, () => current);
  fake.rows.push({ skill: "smithing", experience: 40n });
  fake.settle();
  current = false;
  fake.rows[0] = { skill: "smithing", experience: 90n };
  fake.fire();
  expect(service.api.craftSkills().smithing).toBe(40n);
});

it("crafts with the recipe the client shows, and reports a refusal", async () => {
  const fake = fakeConnection(), service = createCraftingRows(vi.fn());
  expect(await service.api.craftGradeGear("common_bow")).toEqual({ ok: false, error: "NOT CONNECTED" });
  service.watch(fake.connection, () => true);
  expect(await service.api.craftGradeGear("common_bow")).toEqual({ ok: true });
  expect(fake.craftGradeGear).toHaveBeenCalledWith({ itemId: "common_bow", expectedMaterials: craftMaterialsKey(gradeCraftMaterials("common_bow")!) });
  fake.craftGradeGear.mockRejectedValueOnce(new Error("You need Lv 10 Fletching."));
  expect((await service.api.craftGradeGear("uncommon_bow")).ok).toBe(false);
  expect(await service.api.craftGradeGear("iron_bow")).toEqual({ ok: false, error: "That cannot be crafted." });
});
