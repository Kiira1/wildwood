/** The local player's damage per second over the last few seconds, for the on-screen DPS readout. */
export const DPS_WINDOW_MS = 5_000;

type BowSource = 'bow-hit' | 'bow-storm' | 'bow-rocochet';
type SwordSource = 'sword-spin' | 'sword-wave' | 'sword-deflect' | 'sword-hit' | 'sword-cleave' | 'sword-split-shot';
type StaffSource = 'staff-direct' | 'staff-splash' | 'staff-chain' | 'staff-meteor';
type CardSource = 'card-koi' | 'card-splash' | 'card-chain' | 'card-reap' | 'card-burn' | 'card-poison' | 'card-reflect-splash';
export type DamageSource = BowSource | SwordSource | StaffSource | CardSource | 'reflect';

export function createDpsMeter(now: () => number = () => performance.now()) {
  const hits: { at: number; amount: number; source: DamageSource; }[] = [];
  const prune = (at: number) => { while (hits.length && at - hits[0].at > DPS_WINDOW_MS) hits.shift(); };
  return {
    record(amount: number, source: DamageSource) {
      if (!(amount > 0) || !Number.isFinite(amount)) return;
      const at = now();
      prune(at);
      hits.push({ at, amount, source });
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
