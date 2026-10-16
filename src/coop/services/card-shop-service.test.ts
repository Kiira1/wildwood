import { expect, it, vi } from "vitest";
import { createCardShopRows } from "./card-shop-service";

function fakeConnection() {
  const handlers: Array<() => void> = [];
  const applied: Array<() => void> = [];
  const rows: any[] = [];
  const reducers = { buyShopCard: vi.fn(async (_args: { rotation: bigint; cardId: string }) => {}) };
  const connection = {
    isActive: true,
    db: { myCardShopPurchases: {
      iter: () => rows[Symbol.iterator](),
      onInsert: (handler: () => void) => handlers.push(handler),
      onUpdate: (handler: () => void) => handlers.push(handler),
      onDelete: (handler: () => void) => handlers.push(handler),
    } },
    reducers,
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied.push(callback); return this; }, subscribe: vi.fn() }),
  };
  return { connection: connection as never, rows, reducers, settle: () => applied.forEach(callback => callback()), fire: () => handlers.forEach(handler => handler()) };
}

it("serves the cards bought in each rotation and follows new buys", () => {
  const fake = fakeConnection(), notify = vi.fn(), service = createCardShopRows(notify);
  fake.rows.push({ rotation: 7n, cardIds: ["needle_card"] });
  service.watch(fake.connection, () => true);
  fake.settle();
  expect(service.api.cardShopBought(7)).toEqual(["needle_card"]);
  expect(service.api.cardShopBought(8)).toEqual([]);
  fake.rows.splice(0, 1, { rotation: 8n, cardIds: ["brood_card"] });
  fake.fire();
  expect(service.api.cardShopBought(7)).toEqual([]);
  expect(service.api.cardShopBought(8)).toEqual(["brood_card"]);
  expect(notify).toHaveBeenCalled();
});

it("buys through buy_shop_card with the rotation as a u64", async () => {
  const fake = fakeConnection(), service = createCardShopRows(vi.fn());
  expect(await service.api.buyShopCard(7, "needle_card")).toEqual({ ok: false, error: "NOT CONNECTED" });
  service.watch(fake.connection, () => true);
  expect(await service.api.buyShopCard(7, "needle_card")).toEqual({ ok: true });
  expect(fake.reducers.buyShopCard).toHaveBeenCalledWith({ rotation: 7n, cardId: "needle_card" });
});
