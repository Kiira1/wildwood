import { table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import { cardDefinition } from "../../shared/cards";

/**
 * A player's cards: every copy owned, active or not (active-cards.ts). Gear's card slot
 * tables stay for clients that still read them, emptied by migration 59.
 */
export const playerCard = table({ name: "player_card", public: false }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  cardId: t.string(),
  count: t.u32(),
});

export const playerGearSlots = table({ name: "player_gear_slots", public: true }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  itemId: t.string(),
  slots: t.u8(),
  cards: t.array(t.string()),
});

export const playerCopySlots = table({ name: "player_copy_slots", public: false }, {
  copyId: t.u64().primaryKey(),
  identity: t.identity().index("btree"),
  itemId: t.string(),
  slots: t.u8(),
  cards: t.array(t.string()),
});

/** The last cards found, for the client to announce. `sequence` counts every card ever found. */
export const playerCardDrop = table({ name: "player_card_drop", public: false }, {
  identity: t.identity().primaryKey(),
  cardIds: t.array(t.string()),
  sequence: t.u64(),
  droppedAt: t.timestamp(),
});

type Ctx = any;

export const cardKey = (identity: { toHexString(): string }, cardId: string) => `${identity.toHexString()}:${cardId}`;
const CARD_COUNT_MAX = 4_294_967_295;

export function cardCount(ctx: Ctx, identity: Identity, cardId: string) {
  return ctx.db.playerCard.key.find(cardKey(identity, cardId))?.count ?? 0;
}

/** Unknown card ids are ignored. */
export function addCard(ctx: Ctx, identity: Identity, cardId: string, count = 1) {
  const amount = Math.floor(count);
  if (!(amount > 0) || !cardDefinition(cardId)) return;
  const key = cardKey(identity, cardId), current = ctx.db.playerCard.key.find(key);
  if (current) ctx.db.playerCard.key.update({ ...current, count: Math.min(CARD_COUNT_MAX, current.count + amount) });
  else ctx.db.playerCard.insert({ key, identity, cardId, count: amount });
}

function rowsOf(handle: any, identity: Identity): any[] {
  return [...handle.identity.filter(identity)];
}

/** Reset Save and account deletion clear cards and the active ones; prestige keeps them. */
export function removeCardData(ctx: Ctx, identity: Identity) {
  if (ctx.db.playerActiveCard?.identity.find(identity)) ctx.db.playerActiveCard.identity.delete(identity);
  for (const row of rowsOf(ctx.db.playerCard, identity)) ctx.db.playerCard.key.delete(row.key);
  for (const row of rowsOf(ctx.db.playerGearSlots, identity)) ctx.db.playerGearSlots.key.delete(row.key);
  for (const row of rowsOf(ctx.db.playerCopySlots, identity)) ctx.db.playerCopySlots.copyId.delete(row.copyId);
  if (ctx.db.playerCardDrop.identity.find(identity)) ctx.db.playerCardDrop.identity.delete(identity);
  if (ctx.db.playerCardAttackCap?.identity.find(identity)) ctx.db.playerCardAttackCap.identity.delete(identity);
  for (const row of ctx.db.playerBossCardRoll ? rowsOf(ctx.db.playerBossCardRoll, identity) : []) ctx.db.playerBossCardRoll.key.delete(row.key);
  for (const row of ctx.db.playerBuild ? rowsOf(ctx.db.playerBuild, identity) : []) ctx.db.playerBuild.key.delete(row.key);
  for (const row of ctx.db.playerBuildName ? rowsOf(ctx.db.playerBuildName, identity) : []) ctx.db.playerBuildName.key.delete(row.key);
  for (const row of ctx.db.playerCardMeter ? rowsOf(ctx.db.playerCardMeter, identity) : []) ctx.db.playerCardMeter.key.delete(row.key);
}

/** On link the guest's cards and active cards replace the account's, as the bag does. */
export function mergeCardData(ctx: Ctx, guest: Identity, account: Identity) {
  removeCardData(ctx, account);
  const active = ctx.db.playerActiveCard?.identity.find(guest);
  if (active) { ctx.db.playerActiveCard.identity.delete(guest); ctx.db.playerActiveCard.insert({ ...active, identity: account }); }
  for (const row of ctx.db.playerCardMeter ? rowsOf(ctx.db.playerCardMeter, guest) : []) {
    ctx.db.playerCardMeter.key.delete(row.key);
    ctx.db.playerCardMeter.insert({ ...row, key: `${account.toHexString()}:${row.cardId}`, identity: account });
  }
  // The guest's builds and their names come across with the cards they name.
  for (const row of ctx.db.playerBuild ? rowsOf(ctx.db.playerBuild, guest) : []) {
    ctx.db.playerBuild.key.delete(row.key);
    ctx.db.playerBuild.insert({ ...row, key: `${account.toHexString()}:${row.slot}`, identity: account });
  }
  for (const row of ctx.db.playerBuildName ? rowsOf(ctx.db.playerBuildName, guest) : []) {
    ctx.db.playerBuildName.key.delete(row.key);
    ctx.db.playerBuildName.insert({ ...row, key: `${account.toHexString()}:${row.slot}`, identity: account });
  }
  for (const row of rowsOf(ctx.db.playerCard, guest)) {
    ctx.db.playerCard.key.delete(row.key);
    ctx.db.playerCard.insert({ ...row, key: cardKey(account, row.cardId), identity: account });
  }
  for (const row of rowsOf(ctx.db.playerGearSlots, guest)) ctx.db.playerGearSlots.key.delete(row.key);
  for (const row of rowsOf(ctx.db.playerCopySlots, guest)) ctx.db.playerCopySlots.copyId.delete(row.copyId);
  if (ctx.db.playerCardDrop.identity.find(guest)) ctx.db.playerCardDrop.identity.delete(guest);
  for (const row of ctx.db.playerBossCardRoll ? rowsOf(ctx.db.playerBossCardRoll, guest) : []) ctx.db.playerBossCardRoll.key.delete(row.key);
  // The guest's saved attack speed comes across with its cards, so the cap it sits under does too.
  const basis = ctx.db.playerCardAttackCap?.identity.find(guest);
  if (basis) { ctx.db.playerCardAttackCap.identity.delete(guest); ctx.db.playerCardAttackCap.insert({ ...basis, identity: account }); }
}

/** The caller's own card views. */
export function registerGearCards(spacetimedb: typeof spacetimedbType) {
  const myCards = spacetimedb.view({ name: "my_cards", public: true }, t.array(playerCard.rowType),
    (ctx: any) => [...ctx.db.playerCard.identity.filter(ctx.sender)]);
  const myGearSlots = spacetimedb.view({ name: "my_gear_slots", public: true }, t.array(playerGearSlots.rowType),
    (ctx: any) => [...ctx.db.playerGearSlots.identity.filter(ctx.sender)]);
  const myCopySlots = spacetimedb.view({ name: "my_copy_slots", public: true }, t.array(playerCopySlots.rowType),
    (ctx: any) => [...ctx.db.playerCopySlots.identity.filter(ctx.sender)]);
  const myCardDrop = spacetimedb.view({ name: "my_card_drop", public: true }, t.array(playerCardDrop.rowType), (ctx: any) => {
    const row = ctx.db.playerCardDrop.identity.find(ctx.sender);
    return row ? [row] : [];
  });
  return { myCards, myGearSlots, myCopySlots, myCardDrop };
}
