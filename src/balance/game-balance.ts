import { CURVE_HIT_LEVEL, CURVE_STEPS } from "../../shared/curve-steps";
import { defaultBalanceSettings } from "../../shared/map-balance";

/**
 * The balance the game runs: the curve in code (shared/smooth-curve.ts) with every Balance Lab control at 1. The
 * Lab, its scorecard and the Auto Farm sims read this; live-balance.ts is only the database's copy, to compare.
 * `key` names caches of results computed from it, so changing a step never reuses stale ones.
 */
export const GAME_BALANCE = Object.freeze({
  revision: 0,
  key: `curve-${CURVE_STEPS.health}-${CURVE_STEPS.damage}-${CURVE_STEPS.reward}-${CURVE_HIT_LEVEL}`,
  settings: defaultBalanceSettings(),
});
