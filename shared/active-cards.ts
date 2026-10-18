import { cardDefinition, type CardDefinition, type CardSlot } from "./cards";
import type { PrestigePerkRanks } from "./prestige-perks";

/**
 * Active cards: the cards a player has switched on in the Cards tab, by type. Every account has one weapon,
 * helmet and armor card slot; each Card Slots perk rank opens one more of its type, four at most.
 */
export const CARD_TYPES: readonly CardSlot[] = Object.freeze(["HAND", "HEAD", "CHEST"]);
export const BASE_ACTIVE_CARD_SLOTS = 1;
export const MAX_ACTIVE_CARD_SLOTS = 4;
export const CARD_TYPE_NAMES: Readonly<Record<CardSlot, string>> = { HAND: "Weapon", HEAD: "Helmet", CHEST: "Armor" };
export const CARD_SLOT_PERKS = Object.freeze({ HAND: "weaponCards", HEAD: "helmetCards", CHEST: "armorCards" } as const);

/** The chosen cards of each type, in slot order. More than the slots in play is allowed: the extra ones wait. */
export type ActiveCards = Readonly<Record<CardSlot, readonly string[]>>;
export type ActiveCardSlots = Readonly<Record<CardSlot, number>>;

export const NO_ACTIVE_CARDS: ActiveCards = Object.freeze({ HAND: Object.freeze([]), HEAD: Object.freeze([]), CHEST: Object.freeze([]) });
export const BASE_CARD_SLOTS: ActiveCardSlots = Object.freeze({ HAND: BASE_ACTIVE_CARD_SLOTS, HEAD: BASE_ACTIVE_CARD_SLOTS, CHEST: BASE_ACTIVE_CARD_SLOTS });

const clampRank = (rank: unknown) => Math.max(0, Math.min(MAX_ACTIVE_CARD_SLOTS - BASE_ACTIVE_CARD_SLOTS, Math.floor(Number(rank) || 0)));

/** Slots of each type for these perk ranks in play (none during an Aggro run or switched off: one each). */
export function activeCardSlots(ranks: Partial<PrestigePerkRanks> | null | undefined): ActiveCardSlots {
  return {
    HAND: BASE_ACTIVE_CARD_SLOTS + clampRank(ranks?.weaponCards),
    HEAD: BASE_ACTIVE_CARD_SLOTS + clampRank(ranks?.helmetCards),
    CHEST: BASE_ACTIVE_CARD_SLOTS + clampRank(ranks?.armorCards),
  };
}

/** Real cards of the right type only, four of a type at most. */
export function normalizeActiveCards(value: Partial<Record<CardSlot, unknown>> | null | undefined): ActiveCards {
  const list = (type: CardSlot) => (Array.isArray(value?.[type]) ? value![type] as unknown[] : [])
    .filter((cardId): cardId is string => cardDefinition(cardId)?.slot === type).slice(0, MAX_ACTIVE_CARD_SLOTS);
  return { HAND: list("HAND"), HEAD: list("HEAD"), CHEST: list("CHEST") };
}

/** The stored row's columns as active cards. */
export const activeCardsOfRow = (row: { hand?: readonly string[]; head?: readonly string[]; chest?: readonly string[] } | null | undefined): ActiveCards =>
  row ? normalizeActiveCards({ HAND: row.hand, HEAD: row.head, CHEST: row.chest }) : NO_ACTIVE_CARDS;

/** The cards that count: each type's first slots in play. */
export function activeCardsInPlay(active: ActiveCards, slots: ActiveCardSlots): string[] {
  return CARD_TYPES.flatMap(type => active[type].slice(0, Math.max(0, slots[type])));
}

/** True when some type holds more than one card, so the slots in play matter. */
export const needsCardSlots = (active: ActiveCards) => CARD_TYPES.some(type => active[type].length > BASE_ACTIVE_CARD_SLOTS);

export function activeCopies(active: ActiveCards, cardId: string) {
  const card = cardDefinition(cardId);
  return card ? active[card.slot].filter(id => id === cardId).length : 0;
}

/** Why a card cannot be switched on now, or null when it can. One copy owned fills one slot. */
export function activationError(active: ActiveCards, slots: ActiveCardSlots, owned: number, cardId: string): string | null {
  const card = cardDefinition(cardId);
  if (!card) return "That card does not exist.";
  if (owned < 1) return `You have no ${card.enemy} Card.`;
  if (activeCopies(active, card.id) >= owned) return owned === 1 ? `Your ${card.enemy} Card is already active.` : `All ${owned} of your ${card.enemy} Cards are active.`;
  if (active[card.slot].length >= Math.min(MAX_ACTIVE_CARD_SLOTS, slots[card.slot])) return `Every ${CARD_TYPE_NAMES[card.slot]} card slot is full.`;
  return null;
}

export const withCardActivated = (active: ActiveCards, cardId: string): ActiveCards => {
  const card = cardDefinition(cardId);
  return card ? { ...active, [card.slot]: [...active[card.slot], card.id] } : active;
};

export const withCardDeactivated = (active: ActiveCards, type: CardSlot, index: number): ActiveCards =>
  ({ ...active, [type]: active[type].filter((_, at) => at !== index) });

/** No more active copies of a card than owned: extra copies come off from the end. */
export function withinOwned(active: ActiveCards, owned: (cardId: string) => number): ActiveCards {
  const used = new Map<string, number>();
  const keep = (cardId: string) => {
    const next = (used.get(cardId) ?? 0) + 1;
    if (next > owned(cardId)) return false;
    used.set(cardId, next);
    return true;
  };
  return { HAND: active.HAND.filter(keep), HEAD: active.HEAD.filter(keep), CHEST: active.CHEST.filter(keep) };
}

const RARITY_RANK = { regular: 0, elite: 1, boss: 2 } as const;

/**
 * The card a worn item's slots hand over when gear stops holding cards: boss over elite over regular, then the
 * higher tier, then the earlier slot.
 */
export function strongestCard(cardIds: readonly string[]): string | undefined {
  let best: CardDefinition | undefined;
  for (const cardId of cardIds) {
    const card = cardDefinition(cardId);
    if (!card) continue;
    if (!best || RARITY_RANK[card.rarity] > RARITY_RANK[best.rarity]
      || (RARITY_RANK[card.rarity] === RARITY_RANK[best.rarity] && card.tier > best.tier)) best = card;
  }
  return best?.id;
}
