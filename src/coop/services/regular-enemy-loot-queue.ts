import { withRequestDeadline } from "./request-deadline";
import { regularMapLoot, REGULAR_ENEMY_LOOT_BATCH_MAX } from "../../../shared/regular-map-loot";

type Batch = { sequence: number; mapId: string; count: number; sealed: boolean };
type State = { streamId: string; nextSequence: number; batches: Batch[] };
export type EnemyLootRequest = { streamId: string; sequence: bigint; mapId: string; count: number };

/** Persist before sending and retry the same sequence after an interrupted reply. */
export function createRegularEnemyLootQueue(options: {
  identity: () => string;
  tabId: () => string;
  storage: Storage;
  send: (request: EnemyLootRequest) => Promise<boolean>;
}) {
  let owner = "", key = "", epoch = 0;
  let state: State | null = null;
  let inFlight: Promise<boolean> | null = null;
  const empty = (): State => ({ streamId: crypto.randomUUID(), nextSequence: 1, batches: [] });
  function persist() {
    if (key && state) { try { options.storage.setItem(key, JSON.stringify(state)); } catch {} }
  }
  function begin() {
    epoch++;
    inFlight = null;
    owner = options.identity();
    key = owner ? `wildstat-enemy-loot-v1:${owner}:${options.tabId()}` : "";
    state = null;
    if (!owner) return;
    try {
      const saved = JSON.parse(options.storage.getItem(key) ?? "null") as State | null;
      if (saved && typeof saved.streamId === "string" && Number.isSafeInteger(saved.nextSequence) &&
          saved.nextSequence > 0 && Array.isArray(saved.batches) && saved.batches.every(batch =>
            Number.isSafeInteger(batch.sequence) && batch.sequence > 0 && regularMapLoot(batch.mapId).length > 0 &&
            Number.isInteger(batch.count) && batch.count > 0 && batch.count <= REGULAR_ENEMY_LOOT_BATCH_MAX)) state = saved;
    } catch {}
    state ??= empty();
  }
  function flush(): Promise<boolean> {
    if (owner !== options.identity()) begin();
    if (inFlight) return inFlight;
    if (!owner || !state?.batches.length) return Promise.resolve(true);
    const current = state, runEpoch = epoch, runOwner = owner;
    const run = async () => {
      while (current.batches.length) {
        const batch = current.batches[0];
        batch.sealed = true;
        persist();
        let accepted = false;
        try { accepted = await withRequestDeadline(options.send({ streamId: current.streamId, sequence: BigInt(batch.sequence), mapId: batch.mapId, count: batch.count }), 4_000); } catch {}
        if (epoch !== runEpoch || options.identity() !== runOwner) return false;
        if (!accepted) return false;
        current.batches.shift();
        persist();
      }
      return true;
    };
    inFlight = run().finally(() => { if (epoch === runEpoch) inFlight = null; });
    return inFlight;
  }
  return {
    begin, flush,
    record(mapId: string) {
      if (owner !== options.identity()) begin();
      if (!owner || !state || !regularMapLoot(mapId).length) return;
      const tail = state.batches.at(-1);
      if (tail && !tail.sealed && tail.mapId === mapId && tail.count < REGULAR_ENEMY_LOOT_BATCH_MAX) tail.count++;
      else state.batches.push({ sequence: state.nextSequence++, mapId, count: 1, sealed: false });
      persist();
      if (state.batches[0].count >= REGULAR_ENEMY_LOOT_BATCH_MAX) void flush();
    },
    reset() { epoch++; inFlight = null; if (owner) { state = empty(); persist(); } },
    clear() { epoch++; owner = ""; state = null; key = ""; inFlight = null; },
  };
}
