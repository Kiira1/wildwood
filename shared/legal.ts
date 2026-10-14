export const TERMS_VERSION = "2026-08-29";
export const MINIMUM_PLAYER_AGE = 13;
export const AGE_SLIDER_MIN = 1;
export const AGE_SLIDER_MAX = 100;

export const AGE_BAND_UNDER_13 = 0;
export const AGE_BAND_TEEN = 1;
export const AGE_BAND_ADULT = 2;
/**
 * Agreed to the Terms but not asked their age yet (the age question moved from the start
 * screen to the first time chat is opened). Plays, but chat stays locked until a 13+ age is given.
 */
export const AGE_BAND_UNVERIFIED = 3;

export type PlayerAgeBand =
  | typeof AGE_BAND_UNDER_13
  | typeof AGE_BAND_TEEN
  | typeof AGE_BAND_ADULT;

export type EligiblePlayerAgeBand = Exclude<PlayerAgeBand, typeof AGE_BAND_UNDER_13>;

export function playerAgeBand(age: number): PlayerAgeBand {
  if (!Number.isInteger(age) || age < AGE_SLIDER_MIN || age > AGE_SLIDER_MAX) {
    throw new RangeError(`Age must be a whole number from ${AGE_SLIDER_MIN} to ${AGE_SLIDER_MAX}.`);
  }
  if (age < MINIMUM_PLAYER_AGE) return AGE_BAND_UNDER_13;
  if (age < 18) return AGE_BAND_TEEN;
  return AGE_BAND_ADULT;
}

export function isEligiblePlayerAgeBand(ageBand: number): ageBand is EligiblePlayerAgeBand {
  return ageBand === AGE_BAND_TEEN || ageBand === AGE_BAND_ADULT;
}

/** Enough to play: a 13+ age, or not asked yet. Chat needs `isEligiblePlayerAgeBand`. */
export function isPlayableAgeBand(ageBand: number): ageBand is EligiblePlayerAgeBand | typeof AGE_BAND_UNVERIFIED {
  return isEligiblePlayerAgeBand(ageBand) || ageBand === AGE_BAND_UNVERIFIED;
}

export const CHAT_AGE_REQUIRED = "Verify your age to use chat.";
