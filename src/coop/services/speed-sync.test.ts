import { describe, expect, it } from "vitest";
import { SPEED_SYNC_HOLD_MS, SPEED_SYNC_RETRY_DELAY_MS, createSpeedSyncTracker } from "./speed-sync";

/** A speed must settle before it is sent, so offer it either side of the hold. */
function settle(tracker: ReturnType<typeof createSpeedSyncTracker>, speed: number, now: number) {
  tracker.begin(speed, now);
  return tracker.begin(speed, now + SPEED_SYNC_HOLD_MS);
}

describe("movement speed synchronization", () => {
  it("does not resend an acknowledged speed or f32 transport drift", () => {
    const tracker = createSpeedSyncTracker();
    expect(settle(tracker, 250.1, 0)).toBe(true);
    tracker.accept(250.1);
    tracker.observe(250.10000610351562);
    expect(settle(tracker, 250.1, 1)).toBe(false);
  });

  it("resends when a later server write strips the research multiplier", () => {
    const tracker = createSpeedSyncTracker();
    tracker.observe(250.1);
    expect(settle(tracker, 250.1, 0)).toBe(false);
    tracker.observe(205);
    expect(settle(tracker, 250.1, 1)).toBe(true);
  });

  it("retries a rejected equipment transition after a short backoff", () => {
    const tracker = createSpeedSyncTracker();
    tracker.observe(198);
    expect(settle(tracker, 225.5, 0)).toBe(true);
    tracker.reject(225.5, 10);
    expect(settle(tracker, 225.5, 10 + SPEED_SYNC_RETRY_DELAY_MS - 1 - SPEED_SYNC_HOLD_MS)).toBe(false);
    expect(settle(tracker, 225.5, 10 + SPEED_SYNC_RETRY_DELAY_MS)).toBe(true);
  });

  it("serializes speed changes while a reducer is in flight", () => {
    const tracker = createSpeedSyncTracker();
    expect(settle(tracker, 205, 0)).toBe(true);
    expect(settle(tracker, 225.5, 1)).toBe(false);
    tracker.accept(205);
    expect(settle(tracker, 225.5, 2)).toBe(true);
  });

  it("ignores a speed that reverses before it settles", () => {
    const tracker = createSpeedSyncTracker();
    tracker.observe(205, 0);
    // Leaving and re-entering combat inside the hold sends nothing at all.
    for (let now = 0; now < 30_000; now += 1_000) {
      expect(tracker.begin(now % 2_000 === 0 ? 230 : 205, now)).toBe(false);
    }
  });

  it("still sends a speed that is held long enough", () => {
    const tracker = createSpeedSyncTracker();
    tracker.observe(205, 0);
    expect(tracker.begin(230, 0)).toBe(false);
    expect(tracker.begin(230, SPEED_SYNC_HOLD_MS - 1)).toBe(false);
    expect(tracker.begin(230, SPEED_SYNC_HOLD_MS)).toBe(true);
  });
});

it("does not resend against lagging regional snapshots after a root acknowledgement", () => {
  const tracker = createSpeedSyncTracker();
  tracker.observe(180, 0);
  expect(settle(tracker, 205, 0)).toBe(true); tracker.accept(205, 10);
  for (let now = 20; now < 2_000; now += 20) {
    tracker.observe(180, now);
    expect(tracker.begin(205, now)).toBe(false);
  }
  tracker.observe(205, 2_000);
  expect(settle(tracker, 205, 2_500)).toBe(false);
});
it("does not let repeated observations cancel rejection backoff", () => {
  const tracker = createSpeedSyncTracker(); tracker.observe(180);
  settle(tracker, 205, 0); tracker.reject(205, 10);
  tracker.observe(180, 20);
  expect(tracker.begin(205, 20)).toBe(false);
  expect(settle(tracker, 205, 1_010)).toBe(true);
});
