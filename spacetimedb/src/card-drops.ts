import { table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import { CARD_DROP_OUTCOMES, CARD_METER_MULTIPLE, cardForBoss, cardForEnemy } from "../../shared/cards";
import { cardStatFactors, type CardTotals } from "../../shared/card-effects";
import { personalBossDefinition } from "../../shared/personal-bosses";
import { bossRespawnSecondsWithResearch } from "../../shared/utility-research";
import { wornCardTotalsFor } from "./worn-cards";
import { addCard } from "./gear-cards";
import { pinnedMapBalance } from "./map-balance";

type Ctx = any;

/** When each map's boss card was last rolled for a player. A boss claim sooner than the boss can respawn rolls none. */
export const playerBossCardRoll = table({ name: "player_boss_card_roll", public: false }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  rolledAt: t.timestamp(),
});

/** How full each card's meter is, in kills at plain odds; a full one guarantees the card (shared/cards.ts). */
export const playerCardMeter = table({ name: "player_card_meter", public: false }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  cardId: t.string(),
  progress: t.f64(),
});

/** Slack for reports that arrive late or bunched together. */
const BOSS_ROLL_SLACK = 0.75;

/** True, and remembered, when this map's boss has had time to respawn since its last card roll. */
function bossCardRollReady(ctx: Ctx, identity: Identity, mapId: string) {
  const key = `${identity.toHexString()}:${mapId}`;
  const row = ctx.db.playerBossCardRoll.key.find(key);
  const base = pinnedMapBalance(ctx, identity, mapId)?.boss?.respawnSeconds ?? personalBossDefinition(mapId, true)?.respawnSeconds ?? 0;
  const seconds = bossRespawnSecondsWithResearch(base, ctx.db.playerResearch.identity.find(identity)?.bossRespawn ?? 0);
  const now = ctx.timestamp.microsSinceUnixEpoch;
  if (row && now - row.rolledAt.microsSinceUnixEpoch < BigInt(Math.floor(seconds * BOSS_ROLL_SLACK * 1_000_000))) return false;
  if (row) ctx.db.playerBossCardRoll.key.update({ ...row, rolledAt: ctx.timestamp });
  else ctx.db.playerBossCardRoll.insert({ key, identity, rolledAt: ctx.timestamp });
  return true;
}

/** Rolls a card for each paid kill, and one for a boss kill the boss had time to respawn for; finds go to player_card and player_card_drop. */
export function awardCardDrops(ctx: Ctx, identity: Identity, mapId: string, kills: readonly { enemy: string; count: number }[],
  bossKills: number, chanceMultiplier = 1, worn?: CardTotals) {
  const found: string[] = [];
  // Card Hunter cards in the worn gear raise every roll; read only once a kill has a card to roll for.
  let odds = 0, oddsRead = false;
  const roll = (cardId: string, outcomes: number, times: number) => {
    if (times < 1) return;
    if (!oddsRead) { odds = chanceMultiplier * (1 + cardStatFactors(worn ?? wornCardTotalsFor(ctx, identity)).cardHunter); oddsRead = true; }
    const key = `${identity.toHexString()}:${cardId}`;
    const meter = ctx.db.playerCardMeter.key.find(key);
    const full = outcomes * CARD_METER_MULTIPLE;
    let progress = meter?.progress ?? 0;
    for (let kill = 0; kill < times; kill++) {
      progress += odds;
      if (ctx.random() * outcomes < odds || progress >= full) { found.push(cardId); progress = 0; }
    }
    if (meter) ctx.db.playerCardMeter.key.update({ ...meter, progress });
    else ctx.db.playerCardMeter.insert({ key, identity, cardId, progress });
  };
  for (const { enemy, count } of kills) {
    const card = cardForEnemy(mapId, enemy);
    if (card) roll(card.id, CARD_DROP_OUTCOMES[card.rarity], count);
  }
  const boss = bossKills > 0 ? cardForBoss(mapId) : undefined;
  if (boss && bossCardRollReady(ctx, identity, mapId)) roll(boss.id, CARD_DROP_OUTCOMES.boss, 1);
  if (!found.length) return found;
  for (const cardId of found) addCard(ctx, identity, cardId);
  const previous = ctx.db.playerCardDrop.identity.find(identity);
  const next = { identity, cardIds: found, sequence: (previous?.sequence ?? 0n) + BigInt(found.length), droppedAt: ctx.timestamp };
  if (previous) ctx.db.playerCardDrop.identity.update(next);
  else ctx.db.playerCardDrop.insert(next);
  return found;
}
