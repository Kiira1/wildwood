export const ENDLESS_FIRST_TIER = 14;
export const ENDLESS_STAT_STEP = .2;

export function endlessScaling(number: number) {
  if (!Number.isSafeInteger(number) || number < 1) throw new RangeError("Invalid Endless number");
  // Bound authored combat values below the game's stat ceiling even for dev warps.
  const depth = Math.min(number - 1, 1_000_000);
  const stats = 1 + ENDLESS_STAT_STEP * depth;
  return { stats, rewards: Math.sqrt(stats), endurance: (1 + .04 * depth) ** 2 };
}

