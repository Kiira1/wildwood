/**
 * What a refine level does to an item's stat, on its own so the item catalog (items.ts) can use it without
 * importing the refine rules (refine.ts imports the catalog). The rules themselves live in refine.ts.
 */
export const REFINE_MAX = 20;

/**
 * What each level adds: this share of the item's own stat, as its slot tier has left it. Five percent a level
 * to +10 (+50%), ten a level from there (+150% at +20). A higher-tier item gains more, because its stat is
 * bigger.
 */
export const REFINE_STEP_TO_TEN = .05;
export const REFINE_STEP_PAST_TEN = .1;

export function normalizeRefineLevel(level: unknown) {
  const value = Number(level);
  return Number.isFinite(value) ? Math.max(0, Math.min(REFINE_MAX, Math.floor(value))) : 0;
}

/** What an item's stat is multiplied by at this refine level. */
export function refineMultiplier(level: unknown) {
  const refine = normalizeRefineLevel(level);
  return 1 + REFINE_STEP_TO_TEN * Math.min(refine, 10) + REFINE_STEP_PAST_TEN * Math.max(0, refine - 10);
}
