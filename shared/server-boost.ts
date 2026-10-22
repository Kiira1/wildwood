/**
 * Server Boost: a Patreon supporter doubles kill stat rewards, gold, and the
 * wood and ore gathered for everyone online. The server owns the rules; the
 * client reads the same row.
 */
export const SERVER_BOOST_MULTIPLIER = 2;
export const SERVER_BOOST_DURATION_MS = 15 * 60_000;
/** Extending stacks time, never the multiplier, up to this much left. */
export const SERVER_BOOST_MAX_REMAINING_MS = 2 * 60 * 60_000;
export const SERVER_BOOST_COOLDOWN_MS = 24 * 60 * 60_000;
/** A kill report trails its kills by a few seconds, so the server pays the boost this much past the end. */
export const SERVER_BOOST_REPORT_GRACE_MS = 10_000;

export type ServerBoostState = { endsAtMs: number; startedAtMs: number; supporterName: string };

export const serverBoostRemainingMs = (endsAtMs: number, nowMs: number) => Math.max(0, endsAtMs - nowMs);

/** The reward multiplier at `nowMs`: 2 while the boost runs, else 1. */
export function serverBoostMultiplier(endsAtMs: number | undefined, nowMs: number, graceMs = 0) {
  return endsAtMs !== undefined && nowMs < endsAtMs + graceMs ? SERVER_BOOST_MULTIPLIER : 1;
}

/**
 * What a rock or tree broken at `atMs` gives times: 2 for a break inside the boost that runs (with the report
 * grace), else 1. Breaks are judged at their own time because reports trail them by up to 20 seconds.
 */
export function serverBoostGatherMultiplier(boost: { startedAtMs: number; endsAtMs: number } | null | undefined, atMs: number) {
  return boost && atMs >= boost.startedAtMs ? serverBoostMultiplier(boost.endsAtMs, atMs, SERVER_BOOST_REPORT_GRACE_MS) : 1;
}

/** Every count in a yield times `multiplier`. */
export function boostedYield<K extends string>(yieldOf: Partial<Record<K, number>>, multiplier: number): Partial<Record<K, number>> {
  if (multiplier === 1) return yieldOf;
  const boosted: Partial<Record<K, number>> = {};
  for (const [key, count] of Object.entries(yieldOf) as [K, number | undefined][]) boosted[key] = (count ?? 0) * multiplier;
  return boosted;
}

/** How long until this account may start another boost. */
export function serverBoostCooldownMs(lastTriggeredAtMs: number | undefined, nowMs: number) {
  return lastTriggeredAtMs === undefined ? 0 : Math.max(0, lastTriggeredAtMs + SERVER_BOOST_COOLDOWN_MS - nowMs);
}

/**
 * The new end time after a trigger: 15 minutes from now, or 15 more on a
 * running boost. Null when the full 15 minutes would pass the cap, so a
 * supporter never spends their day's boost on time that is thrown away.
 */
export function extendedServerBoostEnd(endsAtMs: number | undefined, nowMs: number) {
  const remaining = serverBoostRemainingMs(endsAtMs ?? 0, nowMs);
  if (remaining + SERVER_BOOST_DURATION_MS > SERVER_BOOST_MAX_REMAINING_MS) return null;
  return nowMs + remaining + SERVER_BOOST_DURATION_MS;
}

/** "14:32", or "1:05:09" past an hour. */
export function formatServerBoostClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60, seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** "23h 5m", "12m", for the cooldown. */
export function formatServerBoostWait(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
