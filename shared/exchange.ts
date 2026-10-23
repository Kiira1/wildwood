/**
 * The Trade Chrysanthemum, the Town's exchange south of the village: signed-in players buy and sell
 * resources and gear for gold. Resources match like an order book; a gear piece is listed at a fixed price,
 * since no two pieces roll alike. The server holds what is offered until it sells or is cancelled.
 */
import { canonicalItemId, isCosmeticOnlyItem, itemDefinition, STARTER_ITEM_IDS, STARTER_STAFF } from "./items";
import { isDuplicateOfferItem } from "./equipment-copies";
import { REFINE_ORES, type OreId } from "./refine";

/** Offers and listings open at once, together: three for everyone, six for Patreon supporters. */
export const EXCHANGE_FREE_OFFERS = 3;
export const EXCHANGE_SUPPORTER_OFFERS = 6;
export const exchangeOfferSlots = (supporter: boolean) => supporter ? EXCHANGE_SUPPORTER_OFFERS : EXCHANGE_FREE_OFFERS;
/** The seller's share taken on every sale, in percent: gold leaves the game. */
export const EXCHANGE_FEE_PERCENT = 2n;
/** The most one unit may cost, and the most units one offer may hold. */
export const EXCHANGE_MAX_PRICE = 1_000_000_000_000n;
export const EXCHANGE_MAX_QUANTITY = 1_000_000;
/** Recent trades kept for the price guide. */
export const EXCHANGE_HISTORY = 200;

export const EXCHANGE_NAME = "Trade Chrysanthemum";

/** Ores, logs and crystals: everything kept in stacks. */
export const isExchangeResource = (itemId: unknown): itemId is OreId =>
  typeof itemId === "string" && Object.prototype.hasOwnProperty.call(REFINE_ORES, itemId);

/**
 * Gear that may be listed: real equipment from drops, the Smith or crafting. Never starter gear, the free
 * starter staff, developer pieces, cosmetics or anything lent by Patreon.
 */
export function isExchangeGear(itemId: unknown) {
  const id = canonicalItemId(itemId);
  if (!id || isCosmeticOnlyItem(id) || !isDuplicateOfferItem(id)) return false;
  if ((STARTER_ITEM_IDS as readonly string[]).includes(id) || id === STARTER_STAFF) return false;
  return Boolean(itemDefinition(id));
}

/** The fee on a sale of `total` gold. */
export const exchangeFee = (total: bigint) => total * EXCHANGE_FEE_PERCENT / 100n;

/** A whole number of units within the limits, or null. */
export function exchangeQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= EXCHANGE_MAX_QUANTITY ? quantity : null;
}

/** A price per unit within the limits, or null. */
export function exchangePrice(value: unknown) {
  if (typeof value !== "bigint") return null;
  return value >= 1n && value <= EXCHANGE_MAX_PRICE ? value : null;
}
