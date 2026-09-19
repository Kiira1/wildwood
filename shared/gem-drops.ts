/**
 * Gems drop from defeats the server has already accepted, so the roll inherits
 * the defeat budget and boss DPS validation rather than trusting a client.
 *
 * Active play pays double the idle rate. The server decides which applies from
 * its own record of the player's activity, never from a reported flag.
 */
export const GEM_DROP_ODDS_ACTIVE = 1_000;
export const GEM_DROP_ODDS_IDLE = 2_000;

/** One independent roll per accepted defeat; a batch can never beat its kills. */
export function rollGemDrops(acceptedDefeats: number, active: boolean, random: () => number) {
  if (!Number.isInteger(acceptedDefeats) || acceptedDefeats < 1) return 0;
  const odds = active ? GEM_DROP_ODDS_ACTIVE : GEM_DROP_ODDS_IDLE;
  let gems = 0;
  for (let index = 0; index < acceptedDefeats; index += 1) if (random() * odds < 1) gems += 1;
  return gems;
}
