import { criticalDamageMultiplier } from "../../shared/critical-damage";
import { prestigePerkValue } from "../../shared/prestige-perks";
import { researchInPlay } from "./bonus-toggles";
import { prestigePerkRanks } from "./prestige";
import { soulStatsFor } from "./soul-dimension";
import { readCritRating } from "./wide-stats";
import { activeCardTotalsFor } from "./active-cards";
import { cardStatFactors } from "../../shared/card-effects";

/**
 * A player's crit chance and multiplier in play, for power (critPowerFactor, shared/player-power.ts):
 * research, Keen Edge and cards for the chance; research, Keen Edge, the soul, the run's rating and cards for
 * the multiplier, under the Crit Cap. As duelDamage counts them (duel-runtime.ts).
 */
export function critPowerFields(ctx: any, identity: any, rating?: number) {
  const research = researchInPlay(ctx, identity);
  const ranks = prestigePerkRanks(ctx, identity);
  const cards = cardStatFactors(activeCardTotalsFor(ctx, identity));
  return {
    critChance: (research?.criticalChance ?? 0) * .01 + prestigePerkValue(ranks, "keenEdge") + cards.critChance,
    critMultiplier: criticalDamageMultiplier({ researchRank: research?.criticalDamage, perks: ranks,
      soul: soulStatsFor(ctx, identity)?.critDamage, rating: rating ?? readCritRating(ctx, identity), capRank: research?.critCap, card: cards.critDamage }),
  };
}
