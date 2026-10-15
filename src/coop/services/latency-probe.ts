import { createLatencySamples } from "./latency-samples";
import { createMainThreadStalls } from "./main-thread-stalls";

/** At most one timed reducer this often: four a second. */
export const LATENCY_SAMPLE_INTERVAL_MS = 250;
/** A round trip this slow is reported, at most once a minute. */
export const LATENCY_SPIKE_MS = 500;
export const LATENCY_SPIKE_REPORT_MS = 60_000;

type Probe = { startedAt: number; epoch: number };

/**
 * The ping readout: times reducers the game sends anyway. A hidden tab is
 * paused, so a reply that waited across a hide or show would read as a ping of
 * the whole absence; those are dropped. A spike is reported with how long this
 * device's main thread was blocked during it, which tells a slow device from a
 * slow network or server.
 */
export function createLatencyProbe(reportSpike: (detail: string) => void, {
  now = () => performance.now(),
  hidden = () => typeof document !== "undefined" && document.hidden,
  onVisibilityChange = (listener: () => void) => { if (typeof document !== "undefined") document.addEventListener("visibilitychange", listener); },
  stalls = createMainThreadStalls(),
} = {}) {
  const samples = createLatencySamples(undefined, undefined, now);
  let reading: number | null = null, lastBegunAt = -Infinity, lastSpikeAt = -Infinity, epoch = 0;
  onVisibilityChange(() => { epoch++; });

  return {
    /** Null when a timing began too recently, unless `always`. */
    begin(always = false): Probe | null {
      const startedAt = now();
      if (!always && startedAt - lastBegunAt < LATENCY_SAMPLE_INTERVAL_MS) return null;
      lastBegunAt = startedAt;
      return { startedAt, epoch };
    },
    finish(probe: Probe | null) {
      if (!probe || hidden() || probe.epoch !== epoch) return;
      const finishedAt = now(), sample = Math.max(0, finishedAt - probe.startedAt);
      samples.record(sample);
      reading = samples.value();
      if (sample < LATENCY_SPIKE_MS || finishedAt - lastSpikeAt < LATENCY_SPIKE_REPORT_MS) return;
      lastSpikeAt = finishedAt;
      const blocked = stalls.blockedMs(probe.startedAt, finishedAt);
      reportSpike(`round trip ${Math.round(sample)} ms · device blocked ${blocked ?? "unknown"} ms`);
    },
    value: () => reading,
    reset() { reading = null; lastBegunAt = -Infinity; samples.reset(); },
  };
}
