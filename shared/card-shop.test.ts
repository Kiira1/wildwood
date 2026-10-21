import { describe, expect, it } from "vitest";
import { CARD_SHOP_OFFER_SIZE, CARD_SHOP_ROTATION_MS, cardShopOffer, cardShopPrice, cardShopRotation, cardShopRotationEndsAt } from "./card-shop";
import { CARDS, cardDefinition } from "./cards";

const HOUR = 60 * 60 * 1000;

describe("the Card Seller's rotation", () => {
  it("changes every three hours on the UTC clock", () => {
    expect(CARD_SHOP_ROTATION_MS).toBe(3 * HOUR);
    const midnight = Date.UTC(2026, 9, 16);
    const rotation = cardShopRotation(midnight);
    expect(rotation * CARD_SHOP_ROTATION_MS).toBe(midnight);
    expect(cardShopRotation(midnight - 1)).toBe(rotation - 1);
    expect(cardShopRotation(midnight + 3 * HOUR - 1)).toBe(rotation);
    expect(cardShopRotation(midnight + 3 * HOUR)).toBe(rotation + 1);
    expect(cardShopRotationEndsAt(rotation)).toBe(midnight + 3 * HOUR);
    // Eight a day, starting at 00:00, 03:00 … 21:00 UTC.
    expect(cardShopRotation(Date.UTC(2026, 9, 17)) - rotation).toBe(8);
  });
});

describe("the offer", () => {
  it("is three different real cards, the same every time for a rotation", () => {
    const start = cardShopRotation(Date.UTC(2026, 9, 16));
    for (let rotation = start; rotation < start + 2_000; rotation++) {
      const offer = cardShopOffer(rotation);
      expect(offer).toHaveLength(CARD_SHOP_OFFER_SIZE);
      expect(new Set(offer).size).toBe(CARD_SHOP_OFFER_SIZE);
      for (const cardId of offer) expect(cardDefinition(cardId), cardId).toBeTruthy();
      expect(cardShopOffer(rotation)).toEqual(offer);
    }
  });

  it("changes from one rotation to the next and reaches the whole catalog, bosses included", () => {
    const start = cardShopRotation(Date.UTC(2026, 9, 16));
    const seen = new Set<string>();
    let repeats = 0;
    for (let rotation = start; rotation < start + 2_000; rotation++) {
      const offer = cardShopOffer(rotation);
      offer.forEach(cardId => seen.add(cardId));
      if (offer.join() === cardShopOffer(rotation + 1).join()) repeats++;
    }
    expect(repeats).toBe(0);
    // Endless's and the trees' cards stay out, so adding them changed no rotation.
    expect(seen.size).toBe(CARDS.filter(card => card.shop !== false).length);
  });
});

describe("prices", () => {
  it("are the card's map-grade ore by rarity, with Starshards for elite and boss cards", () => {
    expect(cardShopPrice("needle_card")).toEqual({ copper_ore: 30 });
    expect(cardShopPrice("king_slime_card")).toEqual({ copper_ore: 60, starshard: 2 });
    expect(cardShopPrice("dragon_card")).toEqual({ copper_ore: 60, starshard: 1 });
    expect(cardShopPrice("magmalisk_card")).toEqual({ copper_ore: 60, starshard: 1 });
    expect(cardShopPrice("depth_raider_card")).toEqual({ iron_ore: 30 });
    expect(cardShopPrice("tempest_kirin_card")).toEqual({ iron_ore: 60, starshard: 1 });
    expect(cardShopPrice("fen_prowler_card")).toEqual({ mithril_ore: 30 });
    expect(cardShopPrice("harvest_oracle_card")).toEqual({ mithril_ore: 60, starshard: 2 });
    expect(cardShopPrice("circuit_prowler_card")).toEqual({ adamant_ore: 30 });
    expect(cardShopPrice("aegis_prime_card")).toEqual({ adamant_ore: 60, starshard: 1 });
    expect(cardShopPrice("not_a_card")).toBeNull();
  });

  it("follow the refine grades: tiers 1-4 copper, 5-8 iron, 9-12 mithril, 13-15 adamant", () => {
    const grade = ["copper_ore", "iron_ore", "mithril_ore", "adamant_ore"];
    for (const card of CARDS.filter(card => card.shop !== false)) {
      const ore = Object.keys(cardShopPrice(card.id)!).find(oreId => oreId !== "starshard");
      expect(ore, card.id).toBe(grade[card.tier <= 4 ? 0 : card.tier <= 8 ? 1 : card.tier <= 12 ? 2 : 3]);
    }
  });
});
