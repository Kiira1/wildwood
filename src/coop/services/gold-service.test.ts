import { expect, it, vi } from "vitest";
import { createGoldRows } from "./gold-service";

function fakeConnection() {
  const handlers: Array<() => void> = [];
  const applied: Array<() => void> = [];
  const rows: any[] = [];
  const subscribe = vi.fn();
  const connection = {
    db: { myGold: {
      iter: () => rows[Symbol.iterator](),
      onInsert: (handler: () => void) => handlers.push(handler),
      onUpdate: (handler: () => void) => handlers.push(handler),
      onDelete: (handler: () => void) => handlers.push(handler),
    } },
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe }),
  };
  return { connection: connection as never, rows, subscribe, settle: () => applied.forEach(callback => callback()), fire: () => handlers.forEach(handler => handler()) };
}

it("serves the account's gold, 0 with no row", () => {
  const fake = fakeConnection(), notify = vi.fn(), service = createGoldRows(notify);
  service.watch(fake.connection, () => true);
  expect(fake.subscribe).toHaveBeenCalledOnce();
  fake.settle();
  expect(service.api.gold()).toBe(0n);
  fake.rows.push({ gold: 42n });
  fake.fire();
  expect(service.api.gold()).toBe(42n);
  expect(notify).toHaveBeenCalledOnce();
  fake.rows.splice(0); fake.fire();
  expect(service.api.gold()).toBe(0n);
});

it("ignores rows from a connection that is no longer current, and starts over on a new one", () => {
  const fake = fakeConnection(), service = createGoldRows(vi.fn());
  let current = true;
  service.watch(fake.connection, () => current);
  fake.rows.push({ gold: 40n });
  fake.settle();
  expect(service.api.gold()).toBe(40n);
  current = false;
  fake.rows[0] = { gold: 90n };
  fake.fire();
  expect(service.api.gold()).toBe(40n);
  service.watch(fakeConnection().connection, () => true);
  expect(service.api.gold()).toBe(0n);
});
