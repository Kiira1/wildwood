import { table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import { MAX_CARD_SLOTS, OWNED_GEAR_SLOTS, canHoldCards, cardDefinition, rollGearSlots } from "../../shared/cards";

/**
 * Cards (shared/cards.ts) on the server: the cards a player holds, and each piece of gear's slots with the
 * cards put in them.
 *
 * Slots belong to one copy of an item, as a refine does (item-refine.ts): the first copy's are in
 * player_gear_slots, keyed like player_item_refine, a kept extra copy's in player_copy_slots, keyed by the
 * copy's id, and they move with a copy when it becomes the first (equipment-copies.ts). No row is gear owned
 * before cards came, or that came without a roll: one empty slot. Anything else has a row, a drop with no
 * slots at all included.
 *
 * New tables rather than columns, for the reason refines are. player_gear_slots is public, so a profile can show
 * another player's cards; the rest are read through the caller's own views.
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

/**
 * The cards a player last found, so the client can say so ("Needle Card!"). `sequence` counts every card ever
 * found, so two finds of the same card still read as two.
 */
export const playerCardDrop = table({ name: "player_card_drop", public: false }, {
  identity: t.identity().primaryKey(),
  cardIds: t.array(t.string()),
  sequence: t.u64(),
  droppedAt: t.timestamp(),
});

type Ctx = any;
export type GearSlots = { slots: number; cards: readonly string[] };

export const cardKey = (identity: { toHexString(): string }, cardId: string) => `${identity.toHexString()}:${cardId}`;
export const gearSlotsKey = (identity: { toHexString(): string }, itemId: string) => `${identity.toHexString()}:${itemId}`;

/** Slots kept between 0 and 4, and only real cards, no more of them than there are slots. */
export function normalizeGearSlots(value: { slots?: unknown; cards?: unknown } | null | undefined): GearSlots {
  const raw = Number(value?.slots);
  const slots = Number.isFinite(raw) ? Math.max(0, Math.min(MAX_CARD_SLOTS, Math.floor(raw))) : OWNED_GEAR_SLOTS;
  const cards = (Array.isArray(value?.cards) ? value.cards : []).filter((cardId): cardId is string => Boolean(cardDefinition(cardId)));
  return { slots, cards: cards.slice(0, slots) };
}

const isOwnedGearDefault = (value: GearSlots) => value.slots === OWNED_GEAR_SLOTS && value.cards.length === 0;

/** One copy's slots and cards: `copyId` 0 is the first copy. */
export function gearSlotsFor(ctx: Ctx, identity: Identity, itemId: string, copyId = 0n): GearSlots {
  const row = copyId === 0n ? ctx.db.playerGearSlots.key.find(gearSlotsKey(identity, itemId)) : ctx.db.playerCopySlots.copyId.find(copyId);
  return row ? normalizeGearSlots(row) : { slots: OWNED_GEAR_SLOTS, cards: [] };
}

/** Writes one copy's slots and cards. One empty slot, what no row means, removes the row. */
export function setGearSlots(ctx: Ctx, identity: Identity, itemId: string, copyId: bigint, value: GearSlots) {
  const next = normalizeGearSlots(value);
  const same = (row: { slots: number; cards: readonly string[] }) =>
    row.slots === next.slots && row.cards.length === next.cards.length && row.cards.every((cardId, index) => cardId === next.cards[index]);
  if (copyId === 0n) {
    const key = gearSlotsKey(identity, itemId);
    const current = ctx.db.playerGearSlots.key.find(key);
    if (isOwnedGearDefault(next)) { if (current) ctx.db.playerGearSlots.key.delete(key); return; }
    if (current) { if (!same(current)) ctx.db.playerGearSlots.key.update({ ...current, slots: next.slots, cards: [...next.cards] }); }
    else ctx.db.playerGearSlots.insert({ key, identity, itemId, slots: next.slots, cards: [...next.cards] });
    return;
  }
  const current = ctx.db.playerCopySlots.copyId.find(copyId);
  if (isOwnedGearDefault(next)) { if (current) ctx.db.playerCopySlots.copyId.delete(copyId); return; }
  if (current) { if (!same(current)) ctx.db.playerCopySlots.copyId.update({ ...current, slots: next.slots, cards: [...next.cards] }); }
  else ctx.db.playerCopySlots.insert({ copyId, identity, itemId, slots: next.slots, cards: [...next.cards] });
}

/**
 * Slots for gear from a drop (shared/cards.ts rollGearSlots): the first copy entering the bag rolls them, and so
 * does every duplicate, raising the first copy's slots when it rolls more. Cards already in it stay.
 */
export function rollDropSlots(ctx: Ctx, identity: Identity, itemId: string, alreadyOwned: boolean, quantity = 1) {
  if (!canHoldCards(itemId) || Math.floor(quantity) < 1) return;
  let next: GearSlots | null = alreadyOwned ? gearSlotsFor(ctx, identity, itemId) : null;
  for (let drop = 0; drop < Math.floor(quantity); drop++) {
    const slots = rollGearSlots(ctx.random() * 100);
    next = next ? { ...next, slots: Math.max(next.slots, slots) } : { slots, cards: [] };
  }
  if (next) setGearSlots(ctx, identity, itemId, 0n, next);
}

/** A copy that is gone takes its slots and its cards with it: nothing of it is left to come back. */
export function clearGearSlots(ctx: Ctx, identity: Identity, itemId: string, copyId = 0n) {
  if (copyId === 0n) {
    const key = gearSlotsKey(identity, itemId);
    if (ctx.db.playerGearSlots.key.find(key)) ctx.db.playerGearSlots.key.delete(key);
  } else if (ctx.db.playerCopySlots.copyId.find(copyId)) ctx.db.playerCopySlots.copyId.delete(copyId);
}

/** Choosing a kept copy makes it the first: the two copies trade slots and cards, as they trade refines. */
export function swapFirstCopySlots(ctx: Ctx, identity: Identity, itemId: string, copyId: bigint) {
  const first = gearSlotsFor(ctx, identity, itemId), copy = gearSlotsFor(ctx, identity, itemId, copyId);
  setGearSlots(ctx, identity, itemId, 0n, copy);
  setGearSlots(ctx, identity, itemId, copyId, first);
}

/** The first copy is gone and a kept copy takes its place: the kept copy's slots and cards come with it. */
export function promoteCopySlots(ctx: Ctx, identity: Identity, itemId: string, copyId: bigint) {
  setGearSlots(ctx, identity, itemId, 0n, gearSlotsFor(ctx, identity, itemId, copyId));
  clearGearSlots(ctx, identity, itemId, copyId);
}

const CARD_COUNT_MAX = 4_294_967_295;

export function cardCount(ctx: Ctx, identity: Identity, cardId: string) {
  return ctx.db.playerCard.key.find(cardKey(identity, cardId))?.count ?? 0;
}

/** Adds cards to the player's collection (the Cards tab). An unknown card is ignored. */
export function addCard(ctx: Ctx, identity: Identity, cardId: string, count = 1) {
  const amount = Math.floor(count);
  if (!(amount > 0) || !cardDefinition(cardId)) return;
  const key = cardKey(identity, cardId), current = ctx.db.playerCard.key.find(key);
  if (current) ctx.db.playerCard.key.update({ ...current, count: Math.min(CARD_COUNT_MAX, current.count + amount) });
  else ctx.db.playerCard.insert({ key, identity, cardId, count: amount });
}

/** Takes one card from the collection, or none when there is none. Returns whether it did. */
export function takeCard(ctx: Ctx, identity: Identity, cardId: string) {
  const key = cardKey(identity, cardId), current = ctx.db.playerCard.key.find(key);
  if (!current || current.count < 1) return false;
  if (current.count === 1) ctx.db.playerCard.key.delete(key);
  else ctx.db.playerCard.key.update({ ...current, count: current.count - 1 });
  return true;
}

function rowsOf(handle: any, identity: Identity): any[] {
  return [...handle.identity.filter(identity)];
}

/** Reset Save and a deleted account take the bag; its slots, the cards in them and the collection go with it. Prestige keeps them. */
export function removeCardData(ctx: Ctx, identity: Identity) {
  for (const row of rowsOf(ctx.db.playerCard, identity)) ctx.db.playerCard.key.delete(row.key);
  for (const row of rowsOf(ctx.db.playerGearSlots, identity)) ctx.db.playerGearSlots.key.delete(row.key);
  for (const row of rowsOf(ctx.db.playerCopySlots, identity)) ctx.db.playerCopySlots.copyId.delete(row.copyId);
  if (ctx.db.playerCardDrop.identity.find(identity)) ctx.db.playerCardDrop.identity.delete(identity);
}

/**
 * A guest's save replaces the account's on link, bag included (mergeEquipmentCopies), so the guest's cards and
 * slots replace the account's: the account's go, and the guest's move over as they were.
 */
export function mergeCardData(ctx: Ctx, guest: Identity, account: Identity) {
  removeCardData(ctx, account);
  for (const row of rowsOf(ctx.db.playerCard, guest)) {
    ctx.db.playerCard.key.delete(row.key);
    ctx.db.playerCard.insert({ ...row, key: cardKey(account, row.cardId), identity: account });
  }
  for (const row of rowsOf(ctx.db.playerGearSlots, guest)) {
    ctx.db.playerGearSlots.key.delete(row.key);
    ctx.db.playerGearSlots.insert({ ...row, key: gearSlotsKey(account, row.itemId), identity: account });
  }
  for (const row of rowsOf(ctx.db.playerCopySlots, guest)) ctx.db.playerCopySlots.copyId.update({ ...row, identity: account });
  if (ctx.db.playerCardDrop.identity.find(guest)) ctx.db.playerCardDrop.identity.delete(guest);
}

/** The caller's own cards and slots. Another player's first-copy slots are read from player_gear_slots by identity (profiles). */
export function registerGearCards(spacetimedb: typeof spacetimedbType) {
  const myCards = spacetimedb.view({ name: "my_cards", public: true }, t.array(playerCard.rowType),
    (ctx: any) => [...ctx.db.playerCard.identity.filter(ctx.sender)]);
  const myGearSlots = spacetimedb.view({ name: "my_gear_slots", public: true }, t.array(playerGearSlots.rowType),
    (ctx: any) => [...ctx.db.playerGearSlots.identity.filter(ctx.sender)]);
  const myCopySlots = spacetimedb.view({ name: "my_copy_slots", public: true }, t.array(playerCopySlots.rowType),
    (ctx: any) => [...ctx.db.playerCopySlots.identity.filter(ctx.sender)]);
  /** The caller's last find, for the client to announce. */
  const myCardDrop = spacetimedb.view({ name: "my_card_drop", public: true }, t.array(playerCardDrop.rowType), (ctx: any) => {
    const row = ctx.db.playerCardDrop.identity.find(ctx.sender);
    return row ? [row] : [];
  });
  return { myCards, myGearSlots, myCopySlots, myCardDrop };
}
