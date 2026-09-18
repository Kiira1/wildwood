import { combatMap, type EnemyDefeat } from "../../../shared/enemy-defeats";
import { withRequestDeadline } from "./request-deadline";
import { REGULAR_ENEMY_LOOT_BATCH_MAX } from "../../../shared/regular-map-loot";

// A healthy socket can still have a slow reducer acknowledgement. Keep this
// below the map transition's 30-second deadline, with room for loadout sync.
export const ENEMY_DEFEAT_ACK_TIMEOUT_MS = 15_000;
export const ENEMY_DEFEAT_BATCH_TIMEOUT_MS = 25_000;

type Batch = { sequence: number; mapId: string; count: number; sealed: boolean; enemies: EnemyDefeat[] };
type State = { streamId: string; nextSequence: number; batches: Batch[]; retryAtMs?: number };
export type EnemyLootRequest = { streamId: string; sequence: bigint; mapId: string; count: number; enemies: EnemyDefeat[] };

/** Persist before sending and retry the same sequence after an interrupted reply. */
export function createRegularEnemyLootQueue(options: {
  identity: () => string;
  tabId: () => string;
  storage: Storage;
  send: (request: EnemyLootRequest) => Promise<boolean | "discard" | "throttled">;
}) {
  let owner = "", key = "", epoch = 0;
  let state: State | null = null;
  let inFlight: Promise<boolean> | null = null;
  let bossRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let bossRetryDelay = 2_000;
  function cancelBossRetry() {
    if (bossRetryTimer !== null) clearTimeout(bossRetryTimer);
    bossRetryTimer = null;
  }
  function scheduleBossRetry() {
    cancelBossRetry();
    if (!owner || !state?.batches.some(batch => batch.enemies.some(entry => entry.enemy === "boss"))) {
      bossRetryDelay = 2_000;
      return;
    }
    const retryEpoch = epoch;
    const throttleDelay = Math.min(30_000, Math.max(0, (state.retryAtMs ?? 0) - Date.now()));
    bossRetryTimer = setTimeout(() => {
      bossRetryTimer = null;
      if (retryEpoch !== epoch) return;
      bossRetryDelay = Math.min(60_000, bossRetryDelay * 2);
      void flush(true);
    }, Math.max(bossRetryDelay, throttleDelay));
  }
  const empty = (): State => ({ streamId: crypto.randomUUID(), nextSequence: 1, batches: [] });
  function persist() {
    if (key && state) { try { options.storage.setItem(key, JSON.stringify(state)); } catch {} }
  }
  function begin() {
    cancelBossRetry(); bossRetryDelay = 2_000;
    epoch++;
    inFlight = null;
    owner = options.identity();
    key = owner ? `wildstat-enemy-defeats-v2:${owner}:${options.tabId()}` : "";
    state = null;
    if (!owner) return;
    try {
      const saved = JSON.parse(options.storage.getItem(key) ?? "null") as State | null;
      if (saved && typeof saved.streamId === "string" && Number.isSafeInteger(saved.nextSequence) &&
          saved.nextSequence > 0 && Array.isArray(saved.batches) && saved.batches.every(batch =>
            Number.isSafeInteger(batch.sequence) && batch.sequence > 0 && combatMap(batch.mapId) &&
            Number.isInteger(batch.count) && batch.count > 0 && batch.count <= REGULAR_ENEMY_LOOT_BATCH_MAX &&
            (Array.isArray(batch.enemies) && batch.enemies.every(entry => typeof entry.enemy === "string" && Number.isInteger(entry.count) && entry.count > 0) && batch.enemies.reduce((sum, entry) => sum + entry.count, 0) === batch.count))) state = saved;
    } catch {}
    state ??= empty();
    scheduleBossRetry();
  }
  function flush(drain = false): Promise<boolean> {
    if (owner !== options.identity()) begin();
    if (inFlight) {
      const runEpoch = epoch;
      return drain ? inFlight.then(ok => ok && epoch === runEpoch ? flush(true) : false) : inFlight;
    }
    if (!owner || !state?.batches.length) { cancelBossRetry(); return Promise.resolve(true); }
    // Even forced portal/save drains respect a known server throttle. Persist it
    // so rapid refreshes cannot turn the same rejected report into a request loop.
    if (Number.isFinite(state.retryAtMs) && state.retryAtMs! > Date.now() && state.retryAtMs! <= Date.now() + 30_000) { scheduleBossRetry(); return Promise.resolve(false); }
    const current = state, runEpoch = epoch, runOwner = owner;
    const batchLimit = current.batches.length;
    const run = async () => {
      let sent = 0;
      while (current.batches.length && (drain || sent < batchLimit)) {
        const batch = current.batches[0];
        if (!batch.sealed) {
          batch.sealed = true;
        }
        persist();
        let accepted: boolean | "discard" | "throttled" = false;
        try { accepted = await withRequestDeadline(options.send({ streamId: current.streamId, sequence: BigInt(batch.sequence), mapId: batch.mapId, count: batch.count, enemies: batch.enemies }), ENEMY_DEFEAT_BATCH_TIMEOUT_MS); } catch {}
        if (epoch !== runEpoch || options.identity() !== runOwner) return false;
        if (accepted === "throttled") { current.retryAtMs = Date.now() + 30_000; persist(); return false; }
        if (!accepted) return false;
        current.retryAtMs = 0;
        current.batches.shift();
        if (accepted === "discard") {
          // A forced map change can invalidate unaccepted reports. Start a fresh
          // ordered stream so that rejection cannot block future valid rewards.
          current.streamId = crypto.randomUUID();
          current.batches.forEach((remaining, index) => { remaining.sequence = index + 1; });
          current.nextSequence = current.batches.length + 1;
        }
        sent++;
        persist();
      }
      return true;
    };
    cancelBossRetry();
    inFlight = run().finally(() => {
      if (epoch !== runEpoch) return;
      inFlight = null;
      // A lost acknowledgement/hydration gap must not leave a boss reward
      // waiting for the five-minute save timer or the player's next boss kill.
      // Retry the same persisted receipt, with backoff, only while a boss waits.
      scheduleBossRetry();
    });
    return inFlight;
  }
  return {
    begin, flush,
    hasPending: () => Boolean(state?.batches.length),
    record(mapId: string, enemy: string) {
      if (owner !== options.identity()) begin();
      if (!owner || !state || !combatMap(mapId) || !enemy) return;
      const tail = state.batches.at(-1);
      if (tail && !tail.sealed && tail.mapId === mapId && tail.count < REGULAR_ENEMY_LOOT_BATCH_MAX) {
        tail.count++;
        const entry = tail.enemies.find(entry => entry.enemy === enemy);
        if (entry) entry.count++; else tail.enemies.push({ enemy, count: 1 });
      }
      else state.batches.push({ sequence: state.nextSequence++, mapId, count: 1, enemies: [{ enemy, count: 1 }], sealed: false });
      persist();
    },
    reset() { cancelBossRetry(); bossRetryDelay = 2_000; epoch++; inFlight = null; if (owner) { state = empty(); persist(); } },
    clear() { cancelBossRetry(); bossRetryDelay = 2_000; epoch++; owner = ""; state = null; key = ""; inFlight = null; },
  };
}
