export const ENDLESS_FIRST_TIER = 14;
export const ENDLESS_STAT_STEP = .2;

export function endlessScaling(number: number) {
  if (!Number.isSafeInteger(number) || number < 1) throw new RangeError("Invalid Endless number");
  // Bound authored combat values below the game's stat ceiling even for dev warps.
  const depth = Math.min(number - 1, 1_000_000);
  // A diminishing absolute jump: +20% of Endless 1 on the first step,
  // +11.7% on the second, +6.4% around map 5, then progressively less.
  // Endurance keeps increasing while reward efficiency falls at every depth.
  const stats = 1 + ENDLESS_STAT_STEP * Math.log2(1 + depth);
  // Keep the existing combat pressure: reducing reward growth must not make
  // already-unlocked deep maps easier. Only the reward stat budget compresses.
  return { stats, combatStats: 1 + ENDLESS_STAT_STEP * depth,
    rewards: Math.sqrt(stats), endurance: (1 + .04 * depth) ** 2 };
}

