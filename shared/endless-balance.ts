export const ENDLESS_FIRST_TIER = 14;
// A tenfold drop in payout rate starts the long-term grind immediately at Endless 1.
// Apply equally to regular enemies and bosses so repeat bosses cannot bypass it.
export const ENDLESS_REWARD_MULTIPLIER = .1;
export const ENDLESS_STAT_STEP = .2;
export const ENDLESS_ENDURANCE_STEP = .1;
export const ENDLESS_ENDURANCE_EXPONENT = 6;

export function endlessScaling(number: number) {
  if (!Number.isSafeInteger(number) || number < 1) throw new RangeError("Invalid Endless number");
  // Bound authored combat values below the game's stat ceiling even for dev warps.
  const depth = Math.min(number - 1, 1_000);
  // A diminishing absolute jump: +20% of Endless 1 on the first step,
  // +11.7% on the second, +6.4% around map 5, then progressively less.
  // Rewards follow this slow curve, while the health requirement below grows
  // much faster. Never multiply rewards by endurance: that cancels the slowdown.
  const stats = 1 + ENDLESS_STAT_STEP * Math.log2(1 + depth);
  // Sixth-power endurance makes the extra damage required between consecutive boss
  // clears grow sharply, rather than only inflating the displayed stat totals.
  // The bounded depth keeps even the largest boss below the 1e36 stat ceiling.
  return { stats, combatStats: 1 + ENDLESS_STAT_STEP * depth,
    rewards: ENDLESS_REWARD_MULTIPLIER * Math.sqrt(stats), endurance: (1 + ENDLESS_ENDURANCE_STEP * depth) ** ENDLESS_ENDURANCE_EXPONENT };
}

