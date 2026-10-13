import type { Identity } from "spacetimedb";
import { CARD_DROP_OUTCOMES, cardForBoss, cardForEnemy } from "../../shared/cards";
import { addCard } from "./gear-cards";

type Ctx = any;

/**
 * Cards from an accepted kill report (shared/cards.ts): every kill of a campaign enemy rolls that enemy's card,
 * once in 10,000 (an elite's in 20,000), and every boss kill its boss's, once in 1,000. Only kills the report
 * was paid for roll, so a clipped claim rolls only what it was paid. `chanceMultiplier` raises every chance
 * alike. What was found goes to the player's cards and to player_card_drop, so the client can say so.
 */
export function awardCardDrops(ctx: Ctx, identity: Identity, mapId: string, kills: readonly { enemy: string; count: number }[],
  bossKills: number, chanceMultiplier = 1) {
  const found: string[] = [];
  const roll = (cardId: string, outcomes: number, times: number) => {
    for (let kill = 0; kill < times; kill++) if (ctx.random() * outcomes < chanceMultiplier) found.push(cardId);
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
