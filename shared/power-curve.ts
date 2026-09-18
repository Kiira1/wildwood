import { campaignMapTargetSeconds } from "./campaign-pacing";

export const MILLION_POWER_TARGET_SECONDS = 86400;
export const ION_POWER_TARGET = 1e15;
export const POWER_CURVE_ROUNDING = 1.25;
export const ION_ENTRY_TARGET_SECONDS = Array.from({ length: 14 }, (_, i) => campaignMapTargetSeconds(i)).reduce((a, b) => a + b, 0);
/** A reference curve, never a gameplay cap. Anchor the first million at one day,
 * then taper logarithmic gains toward a quadrillion on Ion arrival. */
export function targetPlayerPower(seconds: number) {
  const day = Math.max(0, seconds / 86400);
  if (day <= 1) return 10 ** (2 + 4 * Math.sqrt(day));
  const ionDay = ION_ENTRY_TARGET_SECONDS / 86400;
  if (day <= ionDay) {
    const progress = (day - 1) / (ionDay - 1);
    const rounded = -Math.expm1(-POWER_CURVE_ROUNDING * progress) / -Math.expm1(-POWER_CURVE_ROUNDING);
    return 10 ** (6 + 9 * rounded);
  }
  // The long tail is a visual target, not an upper limit on earned power.
  return 10 ** (15 + 2 * (1 - Math.exp(-(day - ionDay) / 4)));
}
export function targetPlayerPowerCurve(durationSeconds: number) {
  return Array.from({ length: 241 }, (_, i) => {
    const timeSeconds = durationSeconds * i / 240;
    return { timeSeconds, power: targetPlayerPower(timeSeconds) };
  });
}
