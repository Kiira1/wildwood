import { CARDS, cardDefinition, type CardRarity } from "./cards";
import { GRADE_ORES, tierGrade, type OreId } from "./refine";

/**
 * The Card Seller in the Town: one shop for everyone, three cards at a time, new ones every three hours on
 * the UTC clock. The offer is worked out from the rotation alone, so the client and the server always agree
 * with no table and no scheduled job. Each player may buy each offered card once a rotation.
 */

export const CARD_SHOP_ROTATION_MS = 3 * 60 * 60 * 1000;
export const CARD_SHOP_OFFER_SIZE = 3;

/** The rotation a moment falls in: rotations start at midnight UTC and every three hours after. */
export const cardShopRotation = (unixMs: number) => Math.floor(unixMs / CARD_SHOP_ROTATION_MS);
/** When a rotation ends and the next one's cards go up. */
export const cardShopRotationEndsAt = (rotation: number) => (rotation + 1) * CARD_SHOP_ROTATION_MS;

/** A small seeded random stream (mulberry32) from the rotation. */
function seededRandom(seed: number) {
  let state = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x5c4d2e1f) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The rotation's three different cards, drawn from the whole catalog. */
export function cardShopOffer(rotation: number): string[] {
  const random = seededRandom(rotation);
  const pool = CARDS.map(card => card.id);
  const offer: string[] = [];
  while (offer.length < CARD_SHOP_OFFER_SIZE && pool.length) offer.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return offer;
}

/** A card's price: its map grade's ore, and Starshards for elite and boss cards. */
const PRICES: Readonly<Record<CardRarity, { ore: number; starshard: number }>> = {
  regular: { ore: 30, starshard: 0 },
  elite: { ore: 60, starshard: 2 },
  boss: { ore: 120, starshard: 5 },
};

/** What a card costs at the Card Seller, or null for no such card. */
export function cardShopPrice(cardId: unknown): Partial<Record<OreId, number>> | null {
  const card = cardDefinition(cardId);
  if (!card) return null;
  const { ore, starshard } = PRICES[card.rarity];
  const price: Partial<Record<OreId, number>> = { [GRADE_ORES[tierGrade(card.tier)]]: ore };
  if (starshard) price.starshard = starshard;
  return price;
}
