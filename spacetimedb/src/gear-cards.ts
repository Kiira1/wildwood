import { SenderError, table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import { MAX_CARD_SLOTS, OWNED_GEAR_SLOTS, canHoldCards, cardDefinition, cardFitsItem, gearSlotsKey, rollGearSlots, type CardSlot } from "../../shared/cards";
import { canonicalItemId } from "../../shared/items";
import { standsAtTheSmith } from "./item-refine";
import { readPlayerProgress } from "./wide-stats";

/**
 * A player's cards, and each copy's slots with their cards. Slots follow their copy, as refines do; no row means
 * one empty slot. player_gear_slots is public so profiles can show another player's cards.
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
export type GearSlots = { slots: number; cards: readonly string[] };

export const cardKey = (identity: { toHexString(): string }, cardId: string) => `${identity.toHexString()}:${cardId}`;
export { gearSlotsKey };

/** 0 to 4 slots, real cards only, no more cards than slots. */
export function normalizeGearSlots(value: { slots?: unknown; cards?: unknown } | null | undefined): GearSlots {
  const raw = Number(value?.slots);
  const slots = Number.isFinite(raw) ? Math.max(0, Math.min(MAX_CARD_SLOTS, Math.floor(raw))) : OWNED_GEAR_SLOTS;
  const cards = (Array.isArray(value?.cards) ? value.cards : []).filter((cardId): cardId is string => Boolean(cardDefinition(cardId)));
  return { slots, cards: cards.slice(0, slots) };
}

const isOwnedGearDefault = (value: GearSlots) => value.slots === OWNED_GEAR_SLOTS && value.cards.length === 0;

/** `copyId` 0 is the first copy. */
export function gearSlotsFor(ctx: Ctx, identity: Identity, itemId: string, copyId = 0n): GearSlots {
  const row = copyId === 0n ? ctx.db.playerGearSlots.key.find(gearSlotsKey(identity, itemId)) : ctx.db.playerCopySlots.copyId.find(copyId);
  return row ? normalizeGearSlots(row) : { slots: OWNED_GEAR_SLOTS, cards: [] };
}

/** One empty slot is the default, so it removes the row. */
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

/** A new item rolls its slots; each duplicate rolls too and raises them if higher, keeping the cards. */
export function rollDropSlots(ctx: Ctx, identity: Identity, itemId: string, alreadyOwned: boolean, quantity = 1) {
  if (!canHoldCards(itemId) || Math.floor(quantity) < 1) return;
  let next: GearSlots | null = alreadyOwned ? gearSlotsFor(ctx, identity, itemId) : null;
  for (let drop = 0; drop < Math.floor(quantity); drop++) {
    const slots = rollGearSlots(ctx.random() * 1000);
    next = next ? { ...next, slots: Math.max(next.slots, slots) } : { slots, cards: [] };
  }
  if (next) setGearSlots(ctx, identity, itemId, 0n, next);
}

/** A copy kept from an offer rolls its own slots, as a drop does. */
export function rollCopySlots(ctx: Ctx, identity: Identity, itemId: string, copyId: bigint) {
  if (canHoldCards(itemId)) setGearSlots(ctx, identity, itemId, copyId, { slots: rollGearSlots(ctx.random() * 1000), cards: [] });
}

/** A destroyed copy takes its slots and cards with it. */
export function clearGearSlots(ctx: Ctx, identity: Identity, itemId: string, copyId = 0n) {
  if (copyId === 0n) {
    const key = gearSlotsKey(identity, itemId);
    if (ctx.db.playerGearSlots.key.find(key)) ctx.db.playerGearSlots.key.delete(key);
  } else if (ctx.db.playerCopySlots.copyId.find(copyId)) ctx.db.playerCopySlots.copyId.delete(copyId);
}

/** Choosing a kept copy swaps its slots and cards with the first copy's. */
export function swapFirstCopySlots(ctx: Ctx, identity: Identity, itemId: string, copyId: bigint) {
  const first = gearSlotsFor(ctx, identity, itemId), copy = gearSlotsFor(ctx, identity, itemId, copyId);
  setGearSlots(ctx, identity, itemId, 0n, copy);
  setGearSlots(ctx, identity, itemId, copyId, first);
}

/** The kept copy replacing a destroyed first copy brings its own slots and cards. */
export function promoteCopySlots(ctx: Ctx, identity: Identity, itemId: string, copyId: bigint) {
  setGearSlots(ctx, identity, itemId, 0n, gearSlotsFor(ctx, identity, itemId, copyId));
  clearGearSlots(ctx, identity, itemId, copyId);
}

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

/** Returns false when the player has none. */
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

/** Reset Save and account deletion clear cards and slots; prestige keeps them. */
export function removeCardData(ctx: Ctx, identity: Identity) {
  for (const row of rowsOf(ctx.db.playerCard, identity)) ctx.db.playerCard.key.delete(row.key);
  for (const row of rowsOf(ctx.db.playerGearSlots, identity)) ctx.db.playerGearSlots.key.delete(row.key);
  for (const row of rowsOf(ctx.db.playerCopySlots, identity)) ctx.db.playerCopySlots.copyId.delete(row.copyId);
  if (ctx.db.playerCardDrop.identity.find(identity)) ctx.db.playerCardDrop.identity.delete(identity);
}

/** On link the guest's cards and slots replace the account's, as the bag does. */
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

export type GearCardDeps = {
  requireControllingPlayer: (ctx: Ctx) => any;
  activeDuelFor: (ctx: Ctx, identity: Identity) => unknown;
  inventoryForProgress: (progress: any) => string[];
  writeProgressAndPresentation: (ctx: Ctx, progress: any) => void;
};

const GEAR_NAMES: Readonly<Record<CardSlot, string>> = { HAND: "a weapon", HEAD: "a helmet", CHEST: "armor" };
const equippedFields = (progress: any): string[] =>
  [progress.equippedHead, progress.equippedChest, progress.equippedFeet, progress.equippedRightHand, progress.equippedLeftHand];

/** Slots a card into a free slot for good, at the Smith. `expectedCards` stops a double tap spending two cards. */
export function slotCardFor(ctx: Ctx, args: { itemId: string; copyId: bigint; cardId: string; expectedCards: number }, deps: GearCardDeps) {
  const player = deps.requireControllingPlayer(ctx);
  if (!standsAtTheSmith(ctx, player)) throw new SenderError("Talk to the Smith first.");
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const itemId = canonicalItemId(args.itemId);
  const card = cardDefinition(args.cardId);
  if (!itemId || !canHoldCards(itemId)) throw new SenderError("That item takes no cards.");
  if (!card) throw new SenderError("That card does not exist.");
  if (!cardFitsItem(card.id, itemId)) throw new SenderError(`A ${card.enemy} Card goes in ${GEAR_NAMES[card.slot]}.`);
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress || !deps.inventoryForProgress(progress).includes(itemId)) throw new SenderError("That item is not in your inventory.");
  const copyId = args.copyId;
  if (copyId !== 0n) {
    const copy = ctx.db.playerEquipmentCopy.id.find(copyId);
    if (!copy || !copy.identity.isEqual(ctx.sender) || copy.itemId !== itemId) throw new SenderError("That copy is not in your inventory.");
  }
  const current = gearSlotsFor(ctx, ctx.sender, itemId, copyId);
  if (current.cards.length !== args.expectedCards) throw new SenderError("That item's cards changed. Try again.");
  if (current.cards.length >= current.slots) throw new SenderError(current.slots ? "Every slot in that item is full." : "That item has no slots.");
  if (!takeCard(ctx, ctx.sender, card.id)) throw new SenderError(`You have no ${card.enemy} Card.`);
  setGearSlots(ctx, ctx.sender, itemId, copyId, { slots: current.slots, cards: [...current.cards, card.id] });
  // A worn item's new card changes the player's stats now.
  if (copyId === 0n && equippedFields(progress).includes(itemId)) deps.writeProgressAndPresentation(ctx, progress);
}

/** The slot_card reducer and the caller's own card views. */
export function registerGearCards(spacetimedb: typeof spacetimedbType, deps: GearCardDeps) {
  const slotCard = spacetimedb.reducer({ itemId: t.string(), copyId: t.u64(), cardId: t.string(), expectedCards: t.u8() },
    (ctx: any, args: { itemId: string; copyId: bigint; cardId: string; expectedCards: number }) => slotCardFor(ctx, args, deps));
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
  return { slotCard, myCards, myGearSlots, myCopySlots, myCardDrop };
}
