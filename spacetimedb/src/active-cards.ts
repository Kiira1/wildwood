import { SenderError, table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import {
  BASE_CARD_SLOTS, CARD_TYPES, NO_ACTIVE_CARDS, activationError, activeCardSlots, activeCardsInPlay, activeCardsOfRow, activeCopies,
  needsCardSlots, normalizeActiveCards, strongestCard, withCardActivated, withCardDeactivated, withinOwned, type ActiveCards,
} from "../../shared/active-cards";
import { NO_CARDS, cardTotals, type CardTotals } from "../../shared/card-effects";
import { cardDefinition, type CardSlot } from "../../shared/cards";
import { addCard, cardCount } from "./gear-cards";
import { aggroChallengeActive } from "./aggro-challenge";
import { bonusOffFor } from "./bonus-toggles";
import { perksInPlayFor } from "../../shared/bonus-toggles";
import { iterPlayerProgress } from "./wide-stats";

/**
 * Each player's active cards by type, in slot order (shared/active-cards.ts). Public so profiles can show them.
 * A copy owned fills one slot; player_card still counts every copy, active or not.
 */
export const playerActiveCard = table({ name: "player_active_card", public: true }, {
  identity: t.identity().primaryKey(),
  hand: t.array(t.string()),
  head: t.array(t.string()),
  chest: t.array(t.string()),
});

type Ctx = any;

export function activeCardsFor(ctx: Ctx, identity: Identity): ActiveCards {
  return activeCardsOfRow(ctx.db.playerActiveCard?.identity.find(identity));
}

/** The slots in play: one each, more with Card Slots perks in play (none during an Aggro run), as prestigePerkRanks counts them. */
export function activeCardSlotsFor(ctx: Ctx, identity: Identity) {
  if (aggroChallengeActive(ctx, identity)) return BASE_CARD_SLOTS;
  const row = ctx.db.playerPrestigeCardPerk?.identity.find(identity);
  if (!row) return BASE_CARD_SLOTS;
  return activeCardSlots(perksInPlayFor({ weaponCards: row.weaponCards, helmetCards: row.helmetCards, armorCards: row.armorCards }, bonusOffFor(ctx, identity)));
}

/** The active cards that count now. Perks are only read when a type holds more than one card. */
export function activeCardIdsFor(ctx: Ctx, identity: Identity): string[] {
  const active = activeCardsFor(ctx, identity);
  return activeCardsInPlay(active, needsCardSlots(active) ? activeCardSlotsFor(ctx, identity) : BASE_CARD_SLOTS);
}

const TOTALS = new Map<string, CardTotals>();
/** The active cards added up; the sums are kept by card list, as few players share many lists. */
export function activeCardTotalsFor(ctx: Ctx, identity: Identity): CardTotals {
  const ids = activeCardIdsFor(ctx, identity);
  if (!ids.length) return NO_CARDS;
  const key = ids.join(",");
  let totals = TOTALS.get(key);
  if (!totals) {
    if (TOTALS.size >= 512) TOTALS.clear();
    TOTALS.set(key, totals = cardTotals(ids));
  }
  return totals;
}

/** Nothing active removes the row. */
export function writeActiveCards(ctx: Ctx, identity: Identity, next: ActiveCards) {
  const current = ctx.db.playerActiveCard.identity.find(identity);
  const row = { identity, hand: [...next.HAND], head: [...next.HEAD], chest: [...next.CHEST] };
  if (CARD_TYPES.every(type => next[type].length === 0)) { if (current) ctx.db.playerActiveCard.identity.delete(identity); return; }
  const same = current && (["hand", "head", "chest"] as const).every(column => current[column].join() === row[column].join());
  if (same) return;
  if (current) ctx.db.playerActiveCard.identity.update(row);
  else ctx.db.playerActiveCard.insert(row);
}

export type ActiveCardDeps = {
  requireControllingPlayer: (ctx: Ctx) => any;
  activeDuelFor: (ctx: Ctx, identity: Identity) => unknown;
  /** Stats, power and the attack speed cap follow the cards in play. */
  afterCardsChanged: (ctx: Ctx, identity: Identity) => void;
};

/** `expectedActive` is how many copies of the card the player saw active, so a double tap switches on one. */
export function activateCardFor(ctx: Ctx, args: { cardId: string; expectedActive: number }, deps: ActiveCardDeps) {
  deps.requireControllingPlayer(ctx);
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const card = cardDefinition(args.cardId);
  if (!card) throw new SenderError("That card does not exist.");
  const active = activeCardsFor(ctx, ctx.sender);
  if (activeCopies(active, card.id) !== args.expectedActive) throw new SenderError("Your active cards changed. Try again.");
  const error = activationError(active, activeCardSlotsFor(ctx, ctx.sender), cardCount(ctx, ctx.sender, card.id), card.id);
  if (error) throw new SenderError(error);
  writeActiveCards(ctx, ctx.sender, withCardActivated(active, card.id));
  deps.afterCardsChanged(ctx, ctx.sender);
}

/** Takes the card at `index` of its type out of play; it stays owned. Waiting cards past the slots count too. */
export function deactivateCardFor(ctx: Ctx, args: { cardType: string; index: number; cardId: string }, deps: ActiveCardDeps) {
  deps.requireControllingPlayer(ctx);
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const type = CARD_TYPES.find(candidate => candidate === args.cardType);
  if (!type) throw new SenderError("That card slot does not exist.");
  const active = activeCardsFor(ctx, ctx.sender);
  if (active[type][args.index] !== args.cardId) throw new SenderError("Your active cards changed. Try again.");
  writeActiveCards(ctx, ctx.sender, withCardDeactivated(active, type, args.index));
  deps.afterCardsChanged(ctx, ctx.sender);
}

/** Saved active cards (a build's) put back: copies no longer owned are skipped, each type up to its slots in play. */
export function restoreActiveCards(ctx: Ctx, identity: Identity, wanted: Partial<Record<CardSlot, unknown>>) {
  const slots = activeCardSlotsFor(ctx, identity);
  const normalized = normalizeActiveCards(wanted);
  const limited = { HAND: normalized.HAND.slice(0, slots.HAND), HEAD: normalized.HEAD.slice(0, slots.HEAD), CHEST: normalized.CHEST.slice(0, slots.CHEST) };
  writeActiveCards(ctx, identity, withinOwned(limited, cardId => cardCount(ctx, identity, cardId)));
}

/**
 * Migration 59 (0.912): gear stops holding cards. Every slotted card goes back to its owner's cards, and the
 * strongest card in each worn weapon, helmet and armor becomes active (strongestCard), one a type. The slot
 * rows are emptied; nothing reads them now.
 */
export function activateCardsFromGear(ctx: Ctx) {
  const worn = new Map<string, Record<CardSlot, string>>();
  for (const progress of iterPlayerProgress(ctx)) {
    worn.set(progress.identity.toHexString(), {
      HAND: progress.equippedRightHand || progress.equippedLeftHand || "", HEAD: progress.equippedHead || "", CHEST: progress.equippedChest || "",
    });
  }
  const picks = new Map<string, { identity: Identity; candidates: Record<CardSlot, string[]> }>();
  const empty = (): Record<CardSlot, string[]> => ({ HAND: [], HEAD: [], CHEST: [] });
  for (const row of [...ctx.db.playerGearSlots.iter()] as any[]) {
    for (const cardId of row.cards as string[]) addCard(ctx, row.identity, cardId);
    const hex = row.identity.toHexString(), gear = worn.get(hex);
    const type = gear && CARD_TYPES.find(candidate => gear[candidate] === row.itemId);
    if (type && row.cards.length) {
      const entry = picks.get(hex) ?? { identity: row.identity, candidates: empty() };
      entry.candidates[type].push(...(row.cards as string[]).filter(cardId => cardDefinition(cardId)?.slot === type));
      picks.set(hex, entry);
    }
    ctx.db.playerGearSlots.key.delete(row.key);
  }
  for (const row of [...ctx.db.playerCopySlots.iter()] as any[]) {
    for (const cardId of row.cards as string[]) addCard(ctx, row.identity, cardId);
    ctx.db.playerCopySlots.copyId.delete(row.copyId);
  }
  for (const { identity, candidates } of picks.values()) {
    if (ctx.db.playerActiveCard.identity.find(identity)) continue;
    const pick = (type: CardSlot): string[] => { const cardId = strongestCard(candidates[type]); return cardId ? [cardId] : []; };
    writeActiveCards(ctx, identity, { ...NO_ACTIVE_CARDS, HAND: pick("HAND"), HEAD: pick("HEAD"), CHEST: pick("CHEST") });
  }
}

export function registerActiveCards(spacetimedb: typeof spacetimedbType, deps: ActiveCardDeps) {
  const activateCard = spacetimedb.reducer({ cardId: t.string(), expectedActive: t.u8() },
    (ctx: any, args: { cardId: string; expectedActive: number }) => activateCardFor(ctx, args, deps));
  const deactivateCard = spacetimedb.reducer({ cardType: t.string(), index: t.u8(), cardId: t.string() },
    (ctx: any, args: { cardType: string; index: number; cardId: string }) => deactivateCardFor(ctx, args, deps));
  const myActiveCards = spacetimedb.view({ name: "my_active_cards", public: true }, t.array(playerActiveCard.rowType), (ctx: any) => {
    const row = ctx.db.playerActiveCard.identity.find(ctx.sender);
    return row ? [row] : [];
  });
  return { activateCard, deactivateCard, myActiveCards };
}
