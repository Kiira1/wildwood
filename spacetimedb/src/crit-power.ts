import { criticalDamageMultiplier } from "../../shared/critical-damage";
import { prestigePerkValue } from "../../shared/prestige-perks";
import { researchInPlay } from "./bonus-toggles";
import { prestigePerkRanks } from "./prestige";
import { soulStatsFor } from "./soul-dimension";
import { readCritRating } from "./wide-stats";

/**
 * A player's crit chance and multiplier in play, for power (critPowerFactor, shared/player-power.ts):
 * research and Keen Edge for the chance; research, Keen Edge, the soul and the run's rating for the
 * multiplier, under the Crit Cap. As duelDamage counts them (duel-runtime.ts).
 */
export function critPowerFields(ctx: any, identity: any) {
  const research = researchInPlay(ctx, identity);
  const ranks = prestigePerkRanks(ctx, identity);
  return {
    critChance: (research?.criticalChance ?? 0) * .01 + prestigePerkValue(ranks, "keenEdge"),
    critMultiplier: criticalDamageMultiplier({ researchRank: research?.criticalDamage, perks: ranks,
      soul: soulStatsFor(ctx, identity)?.critDamage, rating: readCritRating(ctx, identity), capRank: research?.critCap }),
  };
}
