import { GATHER_FLUSH_MS, GATHER_QUEUE_CAP, type GatherClaim } from "../../../shared/gather-batch";
import { REFINE_ORES, type OreId } from "../../../shared/refine";
import { reducerErrorMessage } from "./reducer-errors";
import { withRequestDeadline } from "./request-deadline";

/**
 * Rocks or trees broken on the client that the server has yet to take (shared/gather-batch.ts). Each break is
 * queued and sent with the others as one report: GATHER_FLUSH_MS after the first, at once when the queue is
 * GATHER_QUEUE_CAP long, or whenever `flush` is called (leaving the area, the page going away, a call that reads ores).
 */
export function createGatherQueue(options: {
  /** Sends one report; null with no current connection. */
  send: (claims: readonly GatherClaim[]) => Promise<unknown> | null;
  /** A report came back, or failed with this message. */
  settled: (claims: readonly GatherClaim[], error: string | null) => void;
  /** The breaks waiting changed. */
  changed: () => void;
  flushMs?: number;
}) {
  let queued: GatherClaim[] = [];
  let sending: (readonly GatherClaim[])[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Replies to reports from before `clear` are ignored. */
  let generation = 0;

  function stopTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function flush() {
    stopTimer();
    if (!queued.length) return;
    const batch = queued;
    queued = [];
    let work: Promise<unknown> | null;
    try { work = options.send(batch); } catch (error) { work = Promise.reject(error); }
    if (!work) { options.settled(batch, "Not Connected"); options.changed(); return; }
    sending.push(batch);
    const started = generation;
    // A report cut off by a dropped connection never settles; the deadline lets its rocks stand again.
    void withRequestDeadline(Promise.resolve(work)).then(() => null, (error: unknown) => reducerErrorMessage(error)).then(error => {
      if (started !== generation) return;
      sending = sending.filter(entry => entry !== batch);
      options.settled(batch, error);
      options.changed();
    });
    options.changed();
  }

  return {
    add(claim: GatherClaim) {
      queued.push(claim);
      if (queued.length >= GATHER_QUEUE_CAP) flush();
      else {
        timer ??= setTimeout(flush, options.flushMs ?? GATHER_FLUSH_MS);
        options.changed();
      }
    },
    flush,
    /** Every break not yet answered, on its way or queued, oldest first. */
    pending: (): readonly GatherClaim[] => [...sending.flat(), ...queued],
    /** How many breaks wait to be sent. */
    queued: () => queued.length,
    /** A new connection: breaks not yet sent are let go, and replies to the old one are ignored. */
    clear() {
      generation++;
      stopTimer();
      const had = queued.length + sending.length;
      queued = [];
      sending = [];
      if (had) options.changed();
    },
  };
}
export type GatherQueue = ReturnType<typeof createGatherQueue>;

type Gains = Partial<Record<OreId, number>>;
const isOreId = (value: string): value is OreId => Object.prototype.hasOwnProperty.call(REFINE_ORES, value);
type OreRow = { oreId: string; count: number };
type OreRowEvent = { event?: { tag: string; value?: unknown } };
type OreRows = {
  onInsert: (callback: (ctx: OreRowEvent, row: OreRow) => void) => void;
  onUpdate: (callback: (ctx: OreRowEvent, old: OreRow, row: OreRow) => void) => void;
  onDelete: (callback: (ctx: OreRowEvent, row: OreRow) => void) => void;
};

/**
 * What each report really added to the bag: the ore rows its own reply changed, which arrive ahead of the answer.
 * A report's arguments are tracked when it is sent and its gains taken when it settles.
 */
export function createReportGains() {
  const gains = new WeakMap<object, Gains>();
  const count = (ctx: OreRowEvent, row: OreRow, sign: number) => {
    const args = ctx.event?.tag === "Reducer" ? (ctx.event.value as { reducer?: { args?: unknown } } | undefined)?.reducer?.args : null;
    const into = args && typeof args === "object" ? gains.get(args) : undefined;
    if (into && isOreId(row.oreId)) into[row.oreId] = (into[row.oreId] ?? 0) + sign * row.count;
  };
  return {
    watch(rows: OreRows) {
      rows.onInsert((ctx, row) => count(ctx, row, 1));
      rows.onDelete((ctx, row) => count(ctx, row, -1));
      rows.onUpdate((ctx, old, row) => { count(ctx, old, -1); count(ctx, row, 1); });
    },
    track<T extends object>(args: T): T { gains.set(args, {}); return args; },
    take(args: object | undefined): Gains | null {
      const gained = args ? gains.get(args) : undefined;
      if (args) gains.delete(args);
      return gained ?? null;
    },
  };
}

/** What a report gave beyond what was shown at each break: the server's own rolls (cards, luck, the tool's bonus). */
export function gatherExtras(gained: Gains, shown: Gains): Gains {
  const extra: Gains = {};
  for (const [oreId, count] of Object.entries(gained)) {
    const more = (count ?? 0) - (shown[oreId as OreId] ?? 0);
    if (more > 0) extra[oreId as OreId] = more;
  }
  return extra;
}
