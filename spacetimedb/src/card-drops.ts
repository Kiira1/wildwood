import type { Identity } from "spacetimedb";
import { CARD_DROP_OUTCOMES, cardForBoss, cardForEnemy } from "../../shared/cards";
import { cardStatFactors } from "../../shared/card-effects";
import { wornCardTotalsFor } from "./worn-cards";
import { addCard } from "./gear-cards";

type Ctx = any;

/** Rolls a card for each paid kill and boss kill in a report; finds go to player_card and player_card_drop. */
export function awardCardDrops(ctx: Ctx, identity: Identity, mapId: string, kills: readonly { enemy: string; count: number }[],
  bossKills: number, chanceMultiplier = 1) {
  const found: string[] = [];
  // Card Hunter cards in the worn gear raise every roll.
  const odds = chanceMultiplier * (1 + cardStatFactors(wornCardTotalsFor(ctx, identity)).cardHunter);
  const roll = (cardId: string, outcomes: number, times: number) => {
    for (let kill = 0; kill < times; kill++) if (ctx.random() * outcomes < odds) found.push(cardId);
  };
  for (const { enemy, count } of kills) {
    const card = cardForEnemy(mapId, enemy);
    if (card) roll(card.id, CARD_DROP_OUTCOMES[card.rarity], count);
  }
  const boss = bossKills > 0 ? cardForBoss(mapId) : undefined;
  if (boss) roll(boss.id, CARD_DROP_OUTCOMES.boss, bossKills);
  if (!found.length) return found;
  for (const cardId of found) addCard(ctx, identity, cardId);
  const previous = ctx.db.playerCardDrop.identity.find(identity);
  const next = { identity, cardIds: found, sequence: (previous?.sequence ?? 0n) + BigInt(found.length), droppedAt: ctx.timestamp };
  if (previous) ctx.db.playerCardDrop.identity.update(next);
  else ctx.db.playerCardDrop.insert(next);
  return found;
}
