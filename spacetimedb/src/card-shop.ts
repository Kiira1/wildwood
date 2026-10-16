import { SenderError, table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import { cardDefinition } from "../../shared/cards";
import { cardShopOffer, cardShopPrice, cardShopRotation } from "../../shared/card-shop";
import { REFINE_ORES, type OreId } from "../../shared/refine";
import { TOWN_CARD_SELLER_POSITION, TOWN_CARD_SELLER_SERVER_REACH, TOWN_FEET_OFFSET } from "../../shared/town";
import { isTownMap } from "./town";
import { withinStationReach } from "./door-reach";
import { takeOres } from "./item-refine";
import { addCard } from "./gear-cards";

/**
 * The cards a player bought from the Card Seller in one rotation (shared/card-shop.ts). A new table rather than
 * a column, so publishing it strands no open tab. A buy in a newer rotation deletes the older rows.
 */
export const playerCardShopPurchase = table({ name: "player_card_shop_purchase", public: false }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  rotation: t.u64(),
  cardIds: t.array(t.string()),
});

type Ctx = any;

export const cardShopPurchaseKey = (identity: { toHexString(): string }, rotation: number | bigint) => `${identity.toHexString()}:${rotation}`;

/** The rotation the server's clock is in. */
export const currentCardShopRotation = (ctx: Ctx) => cardShopRotation(Number(ctx.timestamp.microsSinceUnixEpoch / 1000n));

/** Where a player stands (not their feet) at the Card Seller's counter. */
const SELLER_STAND = { x: TOWN_CARD_SELLER_POSITION.x, y: TOWN_CARD_SELLER_POSITION.y - TOWN_FEET_OFFSET };

export function standsAtTheCardSeller(ctx: Ctx, player: Parameters<typeof withinStationReach>[1]) {
  return isTownMap(player.mapId) && withinStationReach(ctx, player, SELLER_STAND, TOWN_CARD_SELLER_SERVER_REACH);
}

const rowsOf = (ctx: Ctx, identity: Identity): any[] => [...ctx.db.playerCardShopPurchase.identity.filter(identity)];

const oreList = (cost: Partial<Record<OreId, number>>) =>
  Object.entries(cost).map(([oreId, count]) => `${count} ${REFINE_ORES[oreId as OreId].name}`).join(" and ");

export type CardShopDeps = {
  requireControllingPlayer: (ctx: Ctx) => any;
  activeDuelFor: (ctx: Ctx, identity: Identity) => unknown;
};

/** One card from the current offer, once a rotation, paid in ore at the Card Seller. */
export function buyShopCardFor(ctx: Ctx, args: { rotation: bigint; cardId: string }, deps: CardShopDeps) {
  const player = deps.requireControllingPlayer(ctx);
  if (!standsAtTheCardSeller(ctx, player)) throw new SenderError("Visit the Card Seller in Town first.");
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const rotation = currentCardShopRotation(ctx);
  if (args.rotation !== BigInt(rotation)) throw new SenderError("The Card Seller has new cards now. Take another look.");
  const card = cardDefinition(args.cardId);
  if (!card || !cardShopOffer(rotation).includes(card.id)) throw new SenderError("That card is not for sale right now.");
  const key = cardShopPurchaseKey(ctx.sender, rotation);
  const bought = ctx.db.playerCardShopPurchase.key.find(key);
  if (bought?.cardIds.includes(card.id)) throw new SenderError("You already bought that card. New cards come every 3 hours.");
  const price = cardShopPrice(card.id)!;
  if (!takeOres(ctx, ctx.sender, price)) throw new SenderError(`You need ${oreList(price)}.`);
  addCard(ctx, ctx.sender, card.id);
  if (bought) ctx.db.playerCardShopPurchase.key.update({ ...bought, cardIds: [...bought.cardIds, card.id] });
  else ctx.db.playerCardShopPurchase.insert({ key, identity: ctx.sender, rotation: BigInt(rotation), cardIds: [card.id] });
  // Only this rotation's buys matter; older ones go.
  for (const row of rowsOf(ctx, ctx.sender)) if (row.key !== key) ctx.db.playerCardShopPurchase.key.delete(row.key);
}

/** On link the guest's buys this rotation join the account's, so the bought cards stay bought; the rest go. */
export function mergeCardShopPurchases(ctx: Ctx, guest: Identity, account: Identity) {
  const rotation = currentCardShopRotation(ctx);
  const guestRows = rowsOf(ctx, guest);
  const guestCards = guestRows.filter(row => row.rotation === BigInt(rotation)).flatMap(row => row.cardIds as string[]);
  for (const row of guestRows) ctx.db.playerCardShopPurchase.key.delete(row.key);
  if (!guestCards.length) return;
  const key = cardShopPurchaseKey(account, rotation), current = ctx.db.playerCardShopPurchase.key.find(key);
  if (current) ctx.db.playerCardShopPurchase.key.update({ ...current, cardIds: [...new Set([...current.cardIds, ...guestCards])] });
  else ctx.db.playerCardShopPurchase.insert({ key, identity: account, rotation: BigInt(rotation), cardIds: guestCards });
}

/** The buy_shop_card reducer and the caller's own buys. */
export function registerCardShop(spacetimedb: typeof spacetimedbType, deps: CardShopDeps) {
  const buyShopCard = spacetimedb.reducer({ rotation: t.u64(), cardId: t.string() },
    (ctx: any, args: { rotation: bigint; cardId: string }) => buyShopCardFor(ctx, args, deps));
  const myCardShopPurchases = spacetimedb.view({ name: "my_card_shop_purchases", public: true }, t.array(playerCardShopPurchase.rowType),
    (ctx: any) => [...ctx.db.playerCardShopPurchase.identity.filter(ctx.sender)]);
  return { buyShopCard, myCardShopPurchases };
}
