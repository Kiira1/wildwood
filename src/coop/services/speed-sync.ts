import { movementSpeedsMatch } from "../../../shared/rules";

export const SPEED_SYNC_RETRY_DELAY_MS = 1_000;
export const SPEED_SYNC_REPLICATION_GRACE_MS = 2_000;
/**
 * Out-of-combat boots drop their bonus the moment a fight starts and restore it
 * once the fight is over, so farming alternates between two speeds all day. Hold
 * a new speed until it settles, and those cycles never reach the account server.
 */
export const SPEED_SYNC_HOLD_MS = 3_000;

/** Tracks acknowledged speed so server-side presentation rewrites are repaired without per-frame traffic. */
export function createSpeedSyncTracker() {
  let confirmed: number | null = null;
  let inFlight: number | null = null;
  let retryAt = 0;
  let observed: number | null = null;
  let settledUntil = 0;
  let pending: number | null = null;
  let pendingSince = 0;

  return {
    reset() {
      observed = null; settledUntil = 0;
      pending = null; pendingSince = 0;
      confirmed = null;
      inFlight = null;
      retryAt = 0;
    },
    observe(speed: number, now = 0) {
      observed = Number.isFinite(speed) ? speed : null;
      // Regional snapshots can lag a successful root speed acknowledgement.
      if (now >= settledUntil || movementSpeedsMatch(observed, confirmed)) confirmed = observed;
    },
    begin(speed: number, now: number) {
      if (now >= settledUntil && observed !== null) confirmed = observed;
      if (!Number.isFinite(speed) || inFlight !== null || now < retryAt || movementSpeedsMatch(confirmed, speed)) {
        pending = null;
        return false;
      }
      // Start the clock on a speed we have not seen, and wait for it to settle.
      if (!movementSpeedsMatch(pending, speed)) { pending = speed; pendingSince = now; return false; }
      if (now - pendingSince < SPEED_SYNC_HOLD_MS) return false;
      pending = null;
      inFlight = speed;
      return true;
    },
    accept(speed: number, now = 0) {
      if (!movementSpeedsMatch(inFlight, speed)) return;
      confirmed = speed;
      settledUntil = now + SPEED_SYNC_REPLICATION_GRACE_MS;
      inFlight = null;
      retryAt = 0;
    },
    reject(speed: number, now: number) {
      if (!movementSpeedsMatch(inFlight, speed)) return;
      inFlight = null;
      retryAt = now + SPEED_SYNC_RETRY_DELAY_MS;
    },
  };
}
