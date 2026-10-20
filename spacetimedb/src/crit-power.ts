import { criticalDamageMultiplier } from "../../shared/critical-damage";
import { prestigePerkValue, type PrestigePerkRanks } from "../../shared/prestige-perks";
import { researchInPlay } from "./bonus-toggles";
import { prestigePerkRanks } from "./prestige";
import { soulStatsFor } from "./soul-dimension";
import { readCritRating } from "./wide-stats";
import { activeCardTotalsFor } from "./active-cards";
import { cardStatFactors, type CardTotals } from "../../shared/card-effects";
import type { SoulStats } from "../../shared/soul-dimension";

/**
 * A player's crit chance and multiplier in play, for power (critPowerFactor, shared/player-power.ts):
 * research, Keen Edge and cards for the chance; research, Keen Edge, the soul, the run's rating and cards for
 * the multiplier, under the Crit Cap. As duelDamage counts them (duel-runtime.ts).
 */
export function critPowerFields(ctx: any, identity: any, rating?: number) {
  return critPowerFrom({ research: researchInPlay(ctx, identity), perks: prestigePerkRanks(ctx, identity), cards: activeCardTotalsFor(ctx, identity),
    soul: soulStatsFor(ctx, identity) })(rating ?? readCritRating(ctx, identity));
}

/** The same from rows a caller already read, priced at any crit rating (a kill report's rewarded row moves it). */
export function critPowerFrom(parts: { research: any; perks: PrestigePerkRanks; cards: CardTotals; soul: SoulStats | null }) {
  const { research, perks } = parts, cards = cardStatFactors(parts.cards);
  const critChance = (research?.criticalChance ?? 0) * .01 + prestigePerkValue(perks, "keenEdge") + cards.critChance;
  return (rating: number) => ({
    critChance,
    critMultiplier: criticalDamageMultiplier({ researchRank: research?.criticalDamage, perks,
      soul: parts.soul?.critDamage, rating, capRank: research?.critCap, card: cards.critDamage }),
  });
}
