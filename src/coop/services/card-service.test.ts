import { afterEach, expect, it, vi } from "vitest";
import { createCardRows } from "./card-service";

afterEach(() => vi.useRealTimers());

function fakeConnection() {
  const handlers: Array<() => void> = [];
  const applied: Array<() => void> = [];
  const rows = { cards: [] as any[], active: [] as any[], drop: [] as any[] };
  const view = (list: unknown[]) => ({
    iter: () => list[Symbol.iterator](),
    onInsert: (handler: () => void) => handlers.push(handler),
    onUpdate: (handler: () => void) => handlers.push(handler),
    onDelete: (handler: () => void) => handlers.push(handler),
  });
  const reducers = { activateCard: vi.fn(async () => {}), deactivateCard: vi.fn(async () => {}) };
  const connection = {
    isActive: true,
    db: { myCards: view(rows.cards), myActiveCards: view(rows.active), myCardDrop: view(rows.drop) },
    reducers,
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe: vi.fn() }),
  };
  return { connection: connection as never, rows, reducers, settle: () => applied.forEach(callback => callback()), fire: () => handlers.forEach(handler => handler()) };
}

it("serves cards owned and the active cards by type, real cards of the right type only", () => {
  const fake = fakeConnection(), service = createCardRows(vi.fn());
  fake.rows.cards.push({ cardId: "needle_card", count: 2 }, { cardId: "not_a_card", count: 5 });
  expect(service.api.activeCards()).toEqual({ HAND: [], HEAD: [], CHEST: [] });
  fake.rows.active.push({ hand: ["needle_card", "brood_card", "not_a_card"], head: ["brood_card"], chest: [] });
  service.watch(fake.connection, () => true);
  fake.settle();
  expect(service.api.cards()).toEqual({ needle_card: 2 });
  expect(service.api.activeCards()).toEqual({ HAND: ["needle_card"], HEAD: ["brood_card"], CHEST: [] });
  fake.rows.active.length = 0;
  fake.fire();
  expect(service.api.activeCards()).toEqual({ HAND: [], HEAD: [], CHEST: [] });
});

it("announces a new find, never the standing one found on connect", () => {
  const fake = fakeConnection(), service = createCardRows(vi.fn());
  const heard = vi.fn();
  service.api.setOnCardDrop(heard);
  fake.rows.drop.push({ cardIds: ["needle_card"], sequence: 1n });
  service.watch(fake.connection, () => true);
  fake.settle();
  expect(heard).not.toHaveBeenCalled();
  fake.rows.drop[0] = { cardIds: ["brood_card"], sequence: 2n };
  fake.fire();
  expect(heard).toHaveBeenCalledTimes(1);
  expect(heard.mock.calls[0][0]).toEqual({ cardIds: ["brood_card"], sequence: 2n });
});

it("switches a card on with the copies the player saw active, off by its slot, and reports the server's refusal", async () => {
  const fake = fakeConnection(), service = createCardRows(vi.fn());
  service.watch(fake.connection, () => true);
  await expect(service.api.activateCard("needle_card", 1)).resolves.toEqual({ ok: true });
  expect(fake.reducers.activateCard).toHaveBeenCalledWith({ cardId: "needle_card", expectedActive: 1 });
  fake.reducers.activateCard.mockRejectedValueOnce(new Error("Every Weapon card slot is full."));
  await expect(service.api.activateCard("needle_card", 1)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("full") });
  await expect(service.api.deactivateCard("HAND", 2, "needle_card")).resolves.toEqual({ ok: true });
  expect(fake.reducers.deactivateCard).toHaveBeenCalledWith({ cardType: "HAND", index: 2, cardId: "needle_card" });
});

it("does nothing without a current connection", async () => {
  const service = createCardRows(vi.fn());
  await expect(service.api.activateCard("needle_card", 0)).resolves.toEqual({ ok: false, error: "NOT CONNECTED" });
});

it("releases an activation that never answers, so the same tap can be retried", async () => {
  vi.useFakeTimers();
  const fake = fakeConnection(), service = createCardRows(vi.fn());
  service.watch(fake.connection, () => true);
  fake.reducers.activateCard.mockImplementationOnce(() => new Promise(() => {}));
  const request = service.api.activateCard("needle_card", 1);
  const completed = vi.fn();
  void request.then(completed);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(completed).toHaveBeenCalledWith({ ok: false, error: "Request timed out. Try again." });
  await expect(service.api.activateCard("needle_card", 1)).resolves.toEqual({ ok: true });
  expect(fake.reducers.activateCard).toHaveBeenLastCalledWith({ cardId: "needle_card", expectedActive: 1 });
});
