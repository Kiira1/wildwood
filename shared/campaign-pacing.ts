/** Active-play calibration anchors. Actual completion is earned through stats,
 * not a time lock: 1m power near day one, Ion near 1qd, Endless near day seven. */
export const CAMPAIGN_ENTRY_TARGET_SECONDS = 7 * 86400;
export const FOREST_TARGET_SECONDS = 60 * 60;
export const CAMPAIGN_PACING_MAPS = 15;
export const DEFAULT_PACING_STEP = 1.45;
// The opening carries the first million-power checkpoint. Later time increases
// gently while the numerical stat scale expands; Endless supplies the long tail.
const OPENING_HOURS = [1, 1.5, 6, 12.5];
const LATE_START_HOURS = 12.5;
const REMAINING_HOURS = 7 * 24 - OPENING_HOURS.reduce((a, b) => a + b, 0);
const LATE_STEP_HOURS = (REMAINING_HOURS - 11 * LATE_START_HOURS) / 55;
export function campaignMapTargetSeconds(index: number, desertSeconds = 90 * 60, step = DEFAULT_PACING_STEP, addedSeconds = 0) {
  if (index === 0) return FOREST_TARGET_SECONDS;
  const hours = OPENING_HOURS[index] ?? (LATE_START_HOURS + LATE_STEP_HOURS * Math.min(10, index - 4));
  return hours * 3600 * (desertSeconds / (90 * 60)) * (step / DEFAULT_PACING_STEP) ** (index - 1) + addedSeconds * (index - 1);
}
