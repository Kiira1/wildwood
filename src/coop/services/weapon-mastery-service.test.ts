import { expect, it, vi } from "vitest";
import { createWeaponMasteryRows } from "./weapon-mastery-service";

function fakeConnection() {
  const handlers: Array<() => void> = [];
  const applied: Array<() => void> = [];
  const rows: any[] = [];
  const subscribe = vi.fn();
  const connection = {
    db: { myWeaponMastery: {
      iter: () => rows[Symbol.iterator](),
      onInsert: (handler: () => void) => handlers.push(handler),
      onUpdate: (handler: () => void) => handlers.push(handler),
      onDelete: (handler: () => void) => handlers.push(handler),
    } },
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe }),
  };
  return { connection: connection as never, rows, subscribe, settle: () => applied.forEach(callback => callback()), fire: () => handlers.forEach(handler => handler()) };
}

it("serves each school's points, 0 for a school with no row, and ignores unknown schools", () => {
  const fake = fakeConnection(), notify = vi.fn(), service = createWeaponMasteryRows(notify);
  service.watch(fake.connection, () => true);
  expect(fake.subscribe).toHaveBeenCalledOnce();
  fake.settle();
  expect(service.api.weaponMastery()).toEqual({ archery: 0n, swordplay: 0n, sorcery: 0n });
  fake.rows.push({ school: "archery", points: 16_700n }, { school: "wrestling", points: 5n });
  fake.fire();
  expect(service.api.weaponMastery()).toEqual({ archery: 16_700n, swordplay: 0n, sorcery: 0n });
  fake.rows.splice(0); fake.fire();
  expect(service.api.weaponMastery().archery).toBe(0n);
  expect(notify).toHaveBeenCalled();
});

it("ignores rows from a connection that is no longer current, and starts over on a new one", () => {
  const fake = fakeConnection(), service = createWeaponMasteryRows(vi.fn());
  let current = true;
  service.watch(fake.connection, () => current);
  fake.rows.push({ school: "sorcery", points: 40n });
  fake.settle();
  expect(service.api.weaponMastery().sorcery).toBe(40n);
  current = false;
  fake.rows[0] = { school: "sorcery", points: 90n };
  fake.fire();
  expect(service.api.weaponMastery().sorcery).toBe(40n);
  service.watch(fakeConnection().connection, () => true);
  expect(service.api.weaponMastery().sorcery).toBe(0n);
});
