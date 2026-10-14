import { afterEach, expect, it, vi } from "vitest";
import { createCardRows } from "./card-service";

afterEach(() => vi.useRealTimers());

function fakeConnection() {
  const handlers: Array<() => void> = [];
  const applied: Array<() => void> = [];
  const rows = { cards: [] as any[], first: [] as any[], copies: [] as any[], drop: [] as any[], meters: [] as any[] };
  const view = (list: unknown[]) => ({
    iter: () => list[Symbol.iterator](),
    onInsert: (handler: () => void) => handlers.push(handler),
    onUpdate: (handler: () => void) => handlers.push(handler),
    onDelete: (handler: () => void) => handlers.push(handler),
  });
  const reducers = { slotCard: vi.fn(async () => {}) };
  const connection = {
    isActive: true,
    db: { myCards: view(rows.cards), myGearSlots: view(rows.first), myCopySlots: view(rows.copies), myCardDrop: view(rows.drop), myCardMeters: view(rows.meters) },
    reducers,
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe: vi.fn() }),
  };
  return { connection: connection as never, rows, reducers, settle: () => applied.forEach(callback => callback()), fire: () => handlers.forEach(handler => handler()) };
}

it("serves cards held and each copy's slots, one empty slot by default", () => {
  const fake = fakeConnection(), service = createCardRows(vi.fn());
  fake.rows.cards.push({ cardId: "needle_card", count: 2 }, { cardId: "not_a_card", count: 5 });
  fake.rows.first.push({ itemId: "ion_bow", slots: 3, cards: ["needle_card", "not_a_card"] });
  fake.rows.copies.push({ copyId: 4n, itemId: "ion_bow", slots: 9, cards: [] });
  service.watch(fake.connection, () => true);
  fake.settle();
  expect(service.api.cards()).toEqual({ needle_card: 2 });
  expect(service.api.gearSlots("ion_bow")).toEqual({ slots: 3, cards: ["needle_card"] });
  expect(service.api.gearSlots("ion_bow", 4n)).toEqual({ slots: 4, cards: [] });
  expect(service.api.gearSlots("sky_bow")).toEqual({ slots: 1, cards: [] });
  expect(service.api.itemCards("ion_bow")).toEqual(["needle_card"]);
  expect(service.api.itemCards("sky_bow")).toEqual([]);
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

it("sends a card with the count of cards the player saw, and reports the server's refusal", async () => {
  const fake = fakeConnection(), service = createCardRows(vi.fn());
  service.watch(fake.connection, () => true);
  await expect(service.api.slotCard("ion_bow", 0n, "needle_card", 1)).resolves.toEqual({ ok: true });
  expect(fake.reducers.slotCard).toHaveBeenCalledWith({ itemId: "ion_bow", copyId: 0n, cardId: "needle_card", expectedCards: 1 });
  fake.reducers.slotCard.mockRejectedValueOnce(new Error("Every slot in that item is full."));
  await expect(service.api.slotCard("ion_bow", 0n, "needle_card", 1)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("full") });
});

it("does nothing without a current connection", async () => {
  const service = createCardRows(vi.fn());
  await expect(service.api.slotCard("ion_bow", 0n, "needle_card", 0)).resolves.toEqual({ ok: false, error: "NOT CONNECTED" });
});

it("releases a slotting request that never answers, so the same slot count can be retried", async () => {
  vi.useFakeTimers();
  const fake = fakeConnection(), service = createCardRows(vi.fn());
  service.watch(fake.connection, () => true);
  fake.reducers.slotCard.mockImplementationOnce(() => new Promise(() => {}));
  const request = service.api.slotCard("ion_bow", 4n, "needle_card", 1);
  const completed = vi.fn();
  void request.then(completed);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(completed).toHaveBeenCalledWith({ ok: false, error: "Request timed out. Try again." });
  await expect(service.api.slotCard("ion_bow", 4n, "needle_card", 1)).resolves.toEqual({ ok: true });
  expect(fake.reducers.slotCard).toHaveBeenLastCalledWith({ itemId: "ion_bow", copyId: 4n, cardId: "needle_card", expectedCards: 1 });
});

it("serves each card's meter from the meters view", () => {
  const fake = fakeConnection();
  const service = createCardRows(() => {});
  service.watch(fake.connection, () => true);
  fake.rows.meters.push({ cardId: "needle_card", progress: 1234 });
  fake.settle();
  expect(service.api.cardMeter("needle_card")).toBe(1234);
  expect(service.api.cardMeter("brood_card")).toBe(0);
});
