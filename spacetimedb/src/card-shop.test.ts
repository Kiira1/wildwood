import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { TOWN_CARD_SELLER_POSITION, TOWN_FEET_OFFSET } from "../../shared/town";
import { CARD_SHOP_ROTATION_MS, cardShopOffer, cardShopPrice, cardShopRotation } from "../../shared/card-shop";
import { CARDS, cardDefinition } from "../../shared/cards";
import { addOres, oreCount } from "./item-refine";
import { cardCount } from "./gear-cards";
import { cardShopPurchaseKey, mergeCardShopPurchases } from "./card-shop";
import { eraseIdentityRows } from "./account-erasure";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const NOON = Date.UTC(2026, 9, 16, 12, 30);
const ROTATION = cardShopRotation(NOON);
const offerWith = (rarity: string) => {
  for (let rotation = ROTATION; ; rotation++) {
    const cardId = cardShopOffer(rotation).find(id => cardDefinition(id)?.rarity === rarity);
    if (cardId) return { rotation, cardId };
  }
};

/** At the Card Seller's counter, at a moment in `rotation`, with plenty of every ore. */
function atTheStall(rotation = ROTATION) {
  const f = crystalFixture();
  f.ctx.timestamp = new Timestamp(BigInt(rotation * CARD_SHOP_ROTATION_MS + 60_000) * 1000n);
  f.patch("player", { mapId: "town", x: TOWN_CARD_SELLER_POSITION.x, y: TOWN_CARD_SELLER_POSITION.y - TOWN_FEET_OFFSET });
  f.transaction(() => {
    for (const oreId of ["copper_ore", "iron_ore", "mithril_ore", "adamant_ore", "starshard"] as const) addOres(f.ctx, f.ctx.sender, oreId, 500);
  });
  const buy = (cardId: string, at = rotation) => f.run(server.buyShopCard, { rotation: BigInt(at), cardId });
  const bought = (at = rotation) => f.db.playerCardShopPurchase.key.find(cardShopPurchaseKey(f.ctx.sender, at))?.cardIds ?? [];
  return { ...f, buy, bought, offer: cardShopOffer(rotation) };
}

describe("buying from the Card Seller", () => {
  it("takes the price in ore, adds the card and remembers the buy", () => {
    const { rotation, cardId } = offerWith("elite");
    const f = atTheStall(rotation);
    const price = cardShopPrice(cardId)!;
    const [ore] = Object.keys(price).filter(id => id !== "starshard") as (keyof typeof price)[];
    f.buy(cardId);
    expect(cardCount(f.ctx, f.ctx.sender, cardId)).toBe(1);
    expect(oreCount(f.ctx, f.ctx.sender, ore)).toBe(500 - 60);
    expect(oreCount(f.ctx, f.ctx.sender, "starshard")).toBe(500 - 2);
    expect(f.bought()).toEqual([cardId]);
  });

  it("sells each offered card once a rotation, so three at most", () => {
    const f = atTheStall();
    for (const cardId of f.offer) f.buy(cardId);
    expect(f.bought()).toEqual(f.offer);
    expect(() => f.buy(f.offer[0])).toThrow("You already bought that card.");
    expect(cardCount(f.ctx, f.ctx.sender, f.offer[0])).toBe(1);
  });

  it("refuses a card that is not in this rotation's offer", () => {
    const f = atTheStall();
    const other = CARDS.find(card => !f.offer.includes(card.id))!;
    expect(() => f.buy(other.id)).toThrow("That card is not for sale right now.");
    expect(() => f.buy("not_a_card")).toThrow("That card is not for sale right now.");
    expect(f.bought()).toEqual([]);
  });

  it("refuses a stale rotation: the shop has changed since the window was opened", () => {
    const f = atTheStall();
    expect(() => f.buy(cardShopOffer(ROTATION - 1)[0], ROTATION - 1)).toThrow("The Card Seller has new cards now.");
    expect(() => f.buy(f.offer[0], ROTATION + 1)).toThrow("The Card Seller has new cards now.");
    expect(cardCount(f.ctx, f.ctx.sender, f.offer[0])).toBe(0);
  });

  it("refuses when the ores are short, and spends nothing", () => {
    const { rotation, cardId } = offerWith("boss");
    const f = atTheStall(rotation);
    f.db.playerOre.key.delete(`${f.ctx.sender.toHexString()}:starshard`);
    const ore = Object.keys(cardShopPrice(cardId)!).find(id => id !== "starshard")!;
    expect(() => f.buy(cardId)).toThrow(/You need 60 .+ Ore and 1 Starshard\./);
    expect(oreCount(f.ctx, f.ctx.sender, ore)).toBe(500);
    expect(oreCount(f.ctx, f.ctx.sender, "starshard")).toBe(0);
    expect(cardCount(f.ctx, f.ctx.sender, cardId)).toBe(0);
    expect(f.bought()).toEqual([]);
  });

  it("is only done at the stall in the Town", () => {
    const f = atTheStall();
    f.patch("player", { mapId: "town", x: TOWN_CARD_SELLER_POSITION.x + 400, y: TOWN_CARD_SELLER_POSITION.y - TOWN_FEET_OFFSET });
    expect(() => f.buy(f.offer[0])).toThrow("Visit the Card Seller in Town first.");
    f.patch("player", { mapId: "crystal_hollows", x: TOWN_CARD_SELLER_POSITION.x, y: TOWN_CARD_SELLER_POSITION.y - TOWN_FEET_OFFSET });
    expect(() => f.buy(f.offer[0])).toThrow("Visit the Card Seller in Town first.");
    expect(f.bought()).toEqual([]);
  });

  it("keeps only the current rotation's buys", () => {
    const f = atTheStall(ROTATION - 1);
    f.buy(f.offer[0]);
    expect(f.bought(ROTATION - 1)).toEqual([f.offer[0]]);
    f.ctx.timestamp = new Timestamp(BigInt(ROTATION * CARD_SHOP_ROTATION_MS + 1_000) * 1000n);
    const next = cardShopOffer(ROTATION);
    f.buy(next[0], ROTATION);
    expect(f.bought(ROTATION)).toEqual([next[0]]);
    expect(f.db.playerCardShopPurchase.key.find(cardShopPurchaseKey(f.ctx.sender, ROTATION - 1))).toBeFalsy();
    expect([...f.db.playerCardShopPurchase.identity.filter(f.ctx.sender)]).toHaveLength(1);
  });
});

describe("the buys of a guest and of a deleted account", () => {
  it("carry this rotation's guest buys to the account on link, and drop the rest", () => {
    const f = atTheStall();
    const guest = identity("e");
    f.transaction(() => {
      f.db.playerCardShopPurchase.insert({ key: cardShopPurchaseKey(guest, ROTATION), identity: guest, rotation: BigInt(ROTATION), cardIds: [f.offer[1]] });
      f.db.playerCardShopPurchase.insert({ key: cardShopPurchaseKey(guest, ROTATION - 1), identity: guest, rotation: BigInt(ROTATION - 1), cardIds: ["needle_card"] });
    });
    f.buy(f.offer[0]);
    f.transaction(() => mergeCardShopPurchases(f.ctx, guest, f.ctx.sender));
    expect(f.bought()).toEqual([f.offer[0], f.offer[1]]);
    expect([...f.db.playerCardShopPurchase.identity.filter(guest)]).toHaveLength(0);
    expect(() => f.buy(f.offer[1])).toThrow("You already bought that card.");
  });

  it("are erased with the account and leave everyone else's", () => {
    const f = atTheStall();
    const other = identity("c");
    f.buy(f.offer[0]);
    f.transaction(() => {
      f.db.playerCardShopPurchase.insert({ key: cardShopPurchaseKey(other, ROTATION), identity: other, rotation: BigInt(ROTATION), cardIds: [f.offer[0]] });
    });
    f.transaction(() => eraseIdentityRows(f.ctx, [f.ctx.sender]));
    expect(f.bought()).toEqual([]);
    expect(f.db.playerCardShopPurchase.key.find(cardShopPurchaseKey(other, ROTATION))?.cardIds).toEqual([f.offer[0]]);
  });
});
