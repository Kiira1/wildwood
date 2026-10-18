import { cardDefinition, type CardSlot } from "../../shared/cards";
import { writeActiveCards } from "../../spacetimedb/src/active-cards";

/**
 * Makes these cards a player's active cards, each in its own type, with the Card Slots perk ranks they need
 * to all be in play. Owning them is up to the test (addCard).
 */
export function setActiveCards(ctx: any, identity: any, cardIds: readonly string[]) {
  const active: Record<CardSlot, string[]> = { HAND: [], HEAD: [], CHEST: [] };
  for (const cardId of cardIds) { const card = cardDefinition(cardId); if (card) active[card.slot].push(card.id); }
  const ranks = { identity, weaponCards: Math.max(0, active.HAND.length - 1), helmetCards: Math.max(0, active.HEAD.length - 1), armorCards: Math.max(0, active.CHEST.length - 1) };
  if (ctx.db.playerPrestigeCardPerk.identity.find(identity)) ctx.db.playerPrestigeCardPerk.identity.delete(identity);
  if (ranks.weaponCards || ranks.helmetCards || ranks.armorCards) ctx.db.playerPrestigeCardPerk.insert(ranks);
  writeActiveCards(ctx, identity, active);
}
