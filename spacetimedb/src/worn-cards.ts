import type { Identity } from "spacetimedb";
import { canHoldCards, gearSlotsKey } from "../../shared/cards";
import { NO_CARDS, cardTotals, equippedCardIds } from "../../shared/card-effects";
import { readPlayerProgress } from "./wide-stats";

/** The cards slotted in a player's first copy of an item (gear-cards.ts player_gear_slots). */
export function itemCardsFor(ctx: any, identity: Identity, itemId: string): readonly string[] {
  if (!canHoldCards(itemId)) return [];
  return ctx.db.playerGearSlots.key.find(gearSlotsKey(identity, itemId))?.cards ?? [];
}

/** The cards in a player's worn weapon, helmet and armor, added up (shared/card-effects.ts). */
export function wornCardTotalsFor(ctx: any, identity: Identity, progress: any = readPlayerProgress(ctx, identity)) {
  if (!progress) return NO_CARDS;
  return cardTotals(equippedCardIds(progress, itemId => itemCardsFor(ctx, identity, itemId)));
}
