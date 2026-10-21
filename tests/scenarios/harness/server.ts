import { vi } from "vitest";
import { ConnectionId, Identity, Timestamp } from "spacetimedb";
import * as server from "../../../spacetimedb/src/index";
import { createMemoryDatabase } from "../../helpers/spacetime-memory-db";
import { nameViewsByExport, registeredViews, scheduledTables } from "../../helpers/spacetime-module";
import { readPlayerProgress } from "../../../spacetimedb/src/wide-stats";
import { AGE_BAND_ADULT, TERMS_VERSION } from "../../../shared/legal";
import { DEVELOPER_IDENTITY } from "../../../shared/developer-identity";
import { PROTOCOL_VERSION, SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../../shared/rules";
import { DATABASE_OWNER_IDENTITY_HEX } from "../../../spacetimedb/src/session-guards";

// The server module loads the host-only SDK registration; this swaps in plain
// callbacks so the real reducers run on an in-memory database.
vi.mock("../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs", () => import("../../helpers/spacetime-module"));

type Reducer = (ctx: any, args?: any) => unknown;
export type PlayerKind = "guest" | "account" | "developer" | "owner";
/** What every answered call tells the in-process clients. */
export type Commit = { reducer: string; args: unknown; sender: Identity; connectionId: ConnectionId | null; error: string | null; timestamp: Timestamp };
type Caller = { identity: Identity; connectionId: ConnectionId | null; kind: PlayerKind };

export const SCENARIO_START_MS = Date.UTC(2026, 9, 20, 12);

export function seededRandom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(next, { integerInRange: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)) });
}

/** A stable identity for a player's name, so a scenario reads the same every run. */
export function identityFor(name: string) {
  let hex = "";
  for (let round = 0; hex.length < 64; round++) {
    let h = 2166136261 ^ round;
    for (const char of `${name}#${round}`) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
    hex += (h >>> 0).toString(16).padStart(8, "0");
  }
  return new Identity(hex.slice(0, 64));
}

const exports = server as unknown as Record<string, unknown>;
nameViewsByExport(exports);
const nameOf = (reducer: Reducer) => Object.entries(exports).find(([, value]) => value === reducer)?.[0] ?? "reducer";
const resolve = (reducer: Reducer | string) => {
  const fn = (typeof reducer === "string" ? exports[reducer] : reducer) as Reducer;
  if (typeof fn !== "function") throw new Error(`No reducer ${String(reducer)}`);
  return { fn, name: typeof reducer === "string" ? reducer : nameOf(fn) };
};
const micros = (value: any): bigint => typeof value === "bigint" ? value
  : typeof value?.microsSinceUnixEpoch === "bigint" ? value.microsSinceUnixEpoch
  : typeof value?.__timestamp_micros_since_unix_epoch__ === "bigint" ? value.__timestamp_micros_since_unix_epoch__
  : typeof value?.micros === "bigint" ? value.micros
  : typeof value?.__time_duration_micros__ === "bigint" ? value.__time_duration_micros__ : BigInt(value ?? 0);

/**
 * The real game server in memory: every reducer, view and procedure of
 * spacetimedb/src on one database, with a clock that only moves when told to.
 * Players join through the same calls a client makes.
 */
export function scenarioWorld(options: { start?: number; seed?: number; clock?: () => number } = {}) {
  const storage = createMemoryDatabase(server.default as never);
  const { db } = storage;
  let ownMs = options.start ?? SCENARIO_START_MS;
  // With `clock` the server reads the test's (fake) clock, so a booted client and the server agree on the time.
  const clockNow = () => options.clock ? options.clock() : ownMs;
  const random = seededRandom(options.seed ?? 7);
  const listeners = new Set<(commit: Commit) => void>();
  const clockListeners = new Set<() => void>();
  const intervalRuns = new Map<string, number>();
  let nextConnection = 1n;
  const databaseIdentity = identityFor("database");

  const timestamp = () => new Timestamp(BigInt(Math.round(clockNow() * 1000)));
  function context(sender: Identity, connectionId: ConnectionId | null, kind: PlayerKind) {
    const jwt = kind === "guest" ? undefined : { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID], subject: sender.toHexString(), fullPayload: {} };
    return { db, sender, connectionId, timestamp: timestamp(), random, senderAuth: jwt ? { jwt } : {}, identity: databaseIdentity, databaseIdentity };
  }

  /** Runs one reducer as `as` in a transaction; a refusal rolls back and throws, as the host does. */
  function run(reducer: Reducer | string, args: unknown, as: Caller) {
    const { fn, name } = resolve(reducer);
    const ctx = context(as.identity, as.connectionId, as.kind);
    let error: string | null = null;
    try {
      return storage.transaction(() => fn(ctx, args ?? {}));
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      throw failure;
    } finally {
      for (const listener of [...listeners]) listener({ reducer: name, args, sender: as.identity, connectionId: as.connectionId, error, timestamp: ctx.timestamp });
    }
  }

  /** A procedure call: its own transactions through withTx, as the host runs them. */
  function procedure(reducer: Reducer | string, args: unknown, as: Caller) {
    const { fn, name } = resolve(reducer);
    const ctx = { ...context(as.identity, as.connectionId, as.kind), withTx: (body: (tx: unknown) => unknown) => storage.transaction(() => body(context(as.identity, as.connectionId, as.kind))) };
    try { return fn(ctx, args ?? {}); } finally {
      for (const listener of [...listeners]) listener({ reducer: name, args, sender: as.identity, connectionId: as.connectionId, error: null, timestamp: ctx.timestamp });
    }
  }

  /** A view's rows for `sender` (by table name, e.g. "my_tools"), as a subscribed client would read them. */
  function view(name: string, sender: Identity) {
    const entry = registeredViews.get(name);
    if (!entry) throw new Error(`No view ${name}`);
    const result = (entry.callback as Reducer)(entry.anonymous ? { db, timestamp: timestamp() } : { db, sender, timestamp: timestamp() }) as unknown;
    return (Array.isArray(result) ? result : result == null ? [] : [result]) as any[];
  }

  /**
   * Runs every scheduled reducer that is due on the server clock, as the host's
   * scheduler would, until nothing more is due. Returns how many ran.
   */
  function runDue(only?: string[]) {
    let ran = 0;
    for (let pass = 0; pass < 50; pass++) {
      let ranThisPass = 0;
      for (const [accessor, reducer] of scheduledTables) {
        if (only && !only.includes(accessor)) continue;
        for (const row of [...db[accessor].iter()]) {
          const at = row.scheduledAt;
          const key = `${accessor}:${String(row.scheduledId)}`;
          const nowMs = clockNow();
          const nowMicros = BigInt(Math.round(nowMs * 1000));
          if (at?.tag === "Interval") {
            const every = Number(micros(at.value)) / 1000;
            const last = intervalRuns.get(key) ?? nowMs - every;
            if (nowMs - last < every) continue;
            intervalRuns.set(key, nowMs);
          } else {
            if (micros(at?.value) > nowMicros) continue;
            // By key: a whole-row match misses rows whose schedule holds SDK objects, and they would rerun forever.
            if (db[accessor].scheduledId) db[accessor].scheduledId.delete(row.scheduledId); else db[accessor].delete(row);
          }
          try { run(reducer() as Reducer, row, { identity: databaseIdentity, connectionId: null, kind: "owner" }); } catch { /* a failed scheduled call rolls back, as on the host */ }
          ranThisPass++;
        }
      }
      ran += ranThisPass;
      if (!ranThisPass) break;
    }
    return ran;
  }

  function player(name: string, kind: PlayerKind = "guest") {
    const identity = kind === "developer" ? new Identity(DEVELOPER_IDENTITY)
      : kind === "owner" ? new Identity(DATABASE_OWNER_IDENTITY_HEX) : identityFor(name);
    const self = {
      name, kind, identity, hex: identity.toHexString(),
      connectionId: null as ConnectionId | null,
      /** Opens a session: the host's connect hook, then the protocol handshake. */
      connect() {
        self.connectionId = new ConnectionId(nextConnection++);
        run(server.onConnect as Reducer, {}, self);
        run("registerProtocol", { protocolVersion: PROTOCOL_VERSION }, self);
        return self;
      },
      /** The socket closes: the host's disconnect hook. */
      disconnect() {
        if (!self.connectionId) return;
        run(server.onDisconnect as Reducer, {}, self);
        self.connectionId = null;
      },
      /** Calls a reducer as this player; throws the server's refusal. */
      call: (reducer: Reducer | string, args: unknown = {}) => run(reducer, args, self),
      /** The server's refusal message for a call, or null when it went through. */
      refusal(reducer: Reducer | string, args: unknown = {}) {
        try { run(reducer, args, self); return null; } catch (error) { return error instanceof Error ? error.message : String(error); }
      },
      procedure: (fn: Reducer | string, args: unknown = {}) => procedure(fn, args, self),
      /** A view's rows for this player, by table name ("my_tools"). */
      view: (name: string) => view(name, identity),
      /** This player's row in a table keyed by identity. */
      row: (table: string) => db[table].identity.find(identity),
      /** This player's rows in a table with an identity index. */
      rows: (table: string) => [...db[table].identity.filter(identity)],
      /** The save as the server reads it (stats, bag and equipment). */
      progress: () => readPlayerProgress({ db } as never, identity),
      /** Fixture setup: overwrite fields of this player's row in an identity-keyed table. */
      patch(table: string, changes: Record<string, unknown>) {
        storage.transaction(() => db[table].identity.update({ ...db[table].identity.find(identity), ...changes }));
      },
    };
    return self;
  }
  type Player = ReturnType<typeof player>;

  /**
   * A player in the world, joined as a client joins: connect, agree to the
   * Terms (as an adult), enter. A new character finishes (skips) the tutorial
   * unless `tutorial` is set.
   */
  function join(name: string, options: { kind?: PlayerKind; tutorial?: boolean } = {}): Player {
    const p = player(name, options.kind ?? "guest").connect();
    p.call("acceptTerms", { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
    p.call("enterWorldWithTutorial", { tabId: `tab-${p.hex.slice(0, 12)}`, forceTakeover: false });
    if (!options.tutorial && db.playerOnboarding.identity.find(p.identity)?.step !== 6) p.call("completeOnboardingStep", { step: 6 });
    return p;
  }

  return {
    db, storage, server, random, databaseIdentity,
    /** Milliseconds since the epoch on the server's clock. */
    now: clockNow,
    timestamp,
    /** Moves the server's clock forward; scheduled reducers wait for runDue(). */
    advance(ms: number) { if (options.clock) throw new Error("This world follows the test clock: advance that instead"); ownMs += ms; for (const listener of [...clockListeners]) listener(); },
    runDue,
    player, join, view,
    /** Calls a reducer as the module itself (scheduled work, owner tooling). */
    asModule: (reducer: Reducer | string, args: unknown = {}) => run(reducer, args, { identity: databaseIdentity, connectionId: null, kind: "owner" }),
    /** Fixture setup outside any player's call; rolled back if it throws. */
    setup: <T>(body: (ctx: ReturnType<typeof context>) => T) => storage.transaction(() => body(context(identityFor("setup"), null, "owner"))),
    /** Hears every call the server answers, accepted or refused. */
    onCommit(listener: (commit: Commit) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Hears the clock move. */
    onAdvance(listener: () => void) { clockListeners.add(listener); return () => { clockListeners.delete(listener); }; },
  };
}
export type ScenarioWorld = ReturnType<typeof scenarioWorld>;
export type ScenarioPlayer = ReturnType<ScenarioWorld["player"]>;
