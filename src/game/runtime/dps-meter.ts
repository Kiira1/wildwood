/** The local player's damage per second over the last few seconds, for the on-screen DPS readout. */
export const DPS_WINDOW_MS = 5_000;

export function createDpsMeter(now: () => number = () => performance.now()) {
  const hits: { at: number; amount: number }[] = [];
  const prune = (at: number) => { while (hits.length && at - hits[0].at > DPS_WINDOW_MS) hits.shift(); };
  return {
    record(amount: number) {
      if (!(amount > 0) || !Number.isFinite(amount)) return;
      const at = now();
      prune(at);
      hits.push({ at, amount });
    },
    /** Damage in the window over the time it covers, at least a second, so a fight's first hits read true. */
    perSecond() {
      const at = now();
      prune(at);
      if (!hits.length) return 0;
      const seconds = Math.min(DPS_WINDOW_MS, Math.max(1_000, at - hits[0].at)) / 1_000;
      return hits.reduce((sum, hit) => sum + hit.amount, 0) / seconds;
    },
  };
}

/** The game's own meter: the combat wiring records each hit, the HUD readout reads it. */
export const playerDps = createDpsMeter();
