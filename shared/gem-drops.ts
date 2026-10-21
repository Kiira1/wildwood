/**
 * Gems are earned from defeats the server has already accepted, so the count
 * inherits the defeat budget and boss DPS validation rather than trusting a
 * client. There is no dice roll: every accepted kill adds credit, and each
 * full block of credit is one gem. Two players with the same kills get the
 * same gems.
 *
 * Every kill earns the same credit: one gem per 1,200 kills. Only the client
 * knows whether a kill was Auto Farm or manual, so the rate never depends on it.
 */
export const GEM_KILL_CREDIT_PER_GEM = 6_000n;
export const GEM_KILL_CREDIT = 5n;

export function gemKillCredit(acceptedDefeats: number): bigint {
  if (!Number.isInteger(acceptedDefeats) || acceptedDefeats < 1) return 0n;
  return BigInt(acceptedDefeats) * GEM_KILL_CREDIT;
}

/** Split accumulated credit into whole gems and the remainder carried forward. */
export function settleGemKillCredit(credit: bigint) {
  if (credit < 0n) return { gems: 0n, remainder: 0n };
  return { gems: credit / GEM_KILL_CREDIT_PER_GEM, remainder: credit % GEM_KILL_CREDIT_PER_GEM };
}
