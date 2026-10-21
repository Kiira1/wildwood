import { ConnectionId, Identity, Timestamp } from "spacetimedb";
import { tables as bindingTables } from "../../../src/module_bindings";
import type { DbConnection } from "../../../src/module_bindings";
import { registeredViews } from "../../helpers/spacetime-module";
import type { Commit, ScenarioPlayer, ScenarioWorld } from "./server";

/**
 * A client connection for one player, shaped like the generated DbConnection,
 * whose reducer calls run on the scenario world's real reducers and whose
 * tables show what that player's subscriptions would: public tables (after
 * the module's row-level filters) and views computed for this player. It
 * stands in for the network only; every client service runs unchanged on it.
 */

type Row = Record<string, any>;
type Listener = (ctx: unknown, ...rows: Row[]) => void;
type BindingTable = { sourceName: string; accessorName: string; tableDef: {
  columns: Record<string, unknown>;
  constraints: { constraint: string; columns: string[] }[];
  resolvedIndexes: { name: string; unique: boolean; columns: string[] }[];
} };

const bindings = bindingTables as unknown as Record<string, BindingTable>;

/** Row-level filters the module exports: "SELECT * FROM t WHERE col = :sender | true | false". */
function visibilityRules(world: ScenarioWorld) {
  const rules = new Map<string, { column: string; value: string }[]>();
  for (const value of Object.values(world.server as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const match = /^SELECT \* FROM (\w+) WHERE (\w+) = (.+)$/i.exec(value.trim());
    if (!match) continue;
    const list = rules.get(match[1]) ?? [];
    list.push({ column: match[2].replace(/_(\w)/g, (_m, c: string) => c.toUpperCase()), value: match[3].trim() });
    rules.set(match[1], list);
  }
  return rules;
}

/** Server rows may carry the server SDK's classes; the client sees its own. */
function clientValue(value: any): any {
  if (value instanceof Identity || value instanceof ConnectionId || value instanceof Timestamp) return value;
  if (value && typeof value === "object") {
    if (typeof value.__timestamp_micros_since_unix_epoch__ === "bigint") return new Timestamp(value.__timestamp_micros_since_unix_epoch__);
    if (typeof value.__identity__ === "bigint") return new Identity(value.__identity__);
    if (typeof value.__connection_id__ === "bigint") return new ConnectionId(value.__connection_id__);
    if (value instanceof Uint8Array) return value.slice();
    if (Array.isArray(value)) return value.map(clientValue);
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, clientValue(inner)]));
  }
  return value;
}

function keyText(value: any): string {
  return JSON.stringify(value, (_key, inner) => typeof inner === "bigint" ? `${inner}n`
    : inner && typeof inner === "object" && typeof inner.toHexString === "function" ? `#${inner.toHexString()}`
    : inner && typeof inner === "object" && typeof inner.microsSinceUnixEpoch === "bigint" ? `@${inner.microsSinceUnixEpoch}` : inner);
}

export type ClientOptions = {
  /** Milliseconds a reducer reply takes; 0 answers on the next microtask. */
  latencyMs?: number;
  /** Holds every reducer call until release() (a network that has stalled). */
  hold?: boolean;
  /** A refusal the server sends back instead of running the call, while this returns one (read at each call). */
  refuse?: (reducer: string) => string | null;
};

export type FakeConnection = ReturnType<typeof connectClient>;

/**
 * Connects `player` (connecting it on the server too unless it already is) and
 * returns its DbConnection. Call `deliver()` (or await `settle()`) to see rows
 * that changed through other players or the clock.
 */
export function connectClient(world: ScenarioWorld, player: ScenarioPlayer, options: ClientOptions = {}) {
  // The options are read live (a scenario may flip hold on the object it passed); setHold overrides this connection alone.
  let holdOverride: boolean | undefined;
  if (!player.connectionId) player.connect();
  const rules = visibilityRules(world);
  const live = new Map<string, Map<string, Row>>();
  const listeners = new Map<string, { insert: Set<Listener>; update: Set<Listener>; delete: Set<Listener> }>();
  const disconnectListeners = new Set<(ctx: unknown, error?: Error) => void>();
  const held: (() => void)[] = [];
  let active = true;
  let disconnectRequested = false;
  let pendingDelivery = false;
  let rowsHeld = false, rowsMissed = false;
  const calls: { reducer: string; args: unknown; error: string | null }[] = [];

  const primaryColumn = (accessor: string) =>
    bindings[accessor].tableDef.constraints.find(constraint => constraint.constraint === "unique" && constraint.columns.length === 1)?.columns[0] ?? null;

  function rowsOf(accessor: string): Row[] {
    const table = bindings[accessor];
    const name = table.sourceName;
    if (registeredViews.has(name)) return world.view(name, player.identity).map(clientValue);
    const serverTable = world.db[accessor];
    if (!serverTable) return [];
    const rowRules = rules.get(name);
    const rows = [...serverTable.iter()] as Row[];
    const visible = rowRules ? rows.filter(row => rowRules.some(rule => rule.value === ":sender"
      ? row[rule.column]?.toHexString?.() === player.hex
      : String(row[rule.column]) === rule.value.replace(/^'|'$/g, ""))) : rows;
    return visible.map(clientValue);
  }

  function keyed(accessor: string, rows: Row[]) {
    const column = primaryColumn(accessor);
    const map = new Map<string, Row>();
    for (const row of rows) map.set(column ? keyText(row[column]) : keyText(row), row);
    return map;
  }

  function track(accessor: string) {
    if (!live.has(accessor)) live.set(accessor, new Map());
    if (!listeners.has(accessor)) listeners.set(accessor, { insert: new Set(), update: new Set(), delete: new Set() });
    return listeners.get(accessor)!;
  }

  let eventFor: Commit | null = null;
  const eventContext = () => ({
    db: connection.db, reducers: connection.reducers,
    event: eventFor && eventFor.sender.toHexString() === player.hex
      ? { tag: "Reducer", value: { timestamp: eventFor.timestamp, callerIdentity: eventFor.sender, status: { tag: "Committed" }, reducer: { name: eventFor.reducer, args: eventFor.args } } }
      : { tag: "UnknownTransaction" },
  });

  /** Brings every table this client has touched up to date, firing row callbacks as the SDK does. */
  function deliver(commit: Commit | null = null) {
    pendingDelivery = false;
    if (!active) return;
    if (rowsHeld) { rowsMissed = true; return; }
    eventFor = commit;
    const ctx = eventContext();
    for (const [accessor, before] of [...live]) {
      const after = keyed(accessor, rowsOf(accessor));
      live.set(accessor, after);
      const handlers = track(accessor);
      for (const [key, row] of before) {
        const next = after.get(key);
        if (!next) handlers.delete.forEach(listener => listener(ctx, row));
        else if (keyText(next) !== keyText(row)) {
          if (primaryColumn(accessor)) handlers.update.forEach(listener => listener(ctx, row, next));
          else { handlers.delete.forEach(listener => listener(ctx, row)); handlers.insert.forEach(listener => listener(ctx, next)); }
        }
      }
      for (const [key, row] of after) if (!before.has(key)) handlers.insert.forEach(listener => listener(ctx, row));
    }
    eventFor = null;
  }
  const scheduleDelivery = () => {
    if (pendingDelivery || !active) return;
    pendingDelivery = true;
    queueMicrotask(() => { if (pendingDelivery) deliver(); });
  };
  const stopCommits = world.onCommit(commit => { if (commit.sender.toHexString() !== player.hex || commit.connectionId !== player.connectionId) scheduleDelivery(); });
  const stopClock = world.onAdvance(scheduleDelivery);

  function tableHandle(accessor: string) {
    const handlers = track(accessor);
    const handle: Record<string, unknown> = {
      iter: () => [...(live.get(accessor)?.values() ?? [])].values(),
      count: () => BigInt(live.get(accessor)?.size ?? 0),
      onInsert: (listener: Listener) => { handlers.insert.add(listener); },
      onUpdate: (listener: Listener) => { handlers.update.add(listener); },
      onDelete: (listener: Listener) => { handlers.delete.add(listener); },
      removeOnInsert: (listener: Listener) => { handlers.insert.delete(listener); },
      removeOnUpdate: (listener: Listener) => { handlers.update.delete(listener); },
      removeOnDelete: (listener: Listener) => { handlers.delete.delete(listener); },
    };
    for (const index of bindings[accessor].tableDef.resolvedIndexes) {
      const matches = (row: Row, value: unknown) => {
        const values = index.columns.length > 1 && Array.isArray(value) ? value : [value];
        return values.every((part, i) => keyText(row[index.columns[i]]) === keyText(part));
      };
      handle[index.name] = {
        find: (value: unknown) => [...(live.get(accessor)?.values() ?? [])].find(row => matches(row, value)) ?? undefined,
        filter: (value: unknown) => [...(live.get(accessor)?.values() ?? [])].filter(row => matches(row, value)).values(),
      };
    }
    return handle;
  }
  const handles = new Map<string, Record<string, unknown>>();
  const db = new Proxy({}, {
    get(_target, accessor: string) {
      if (!(accessor in bindings)) return undefined;
      if (!handles.has(accessor)) handles.set(accessor, tableHandle(accessor));
      return handles.get(accessor);
    },
  });

  /** One reducer call over the "network": runs on the server, rows arrive, then the promise settles. */
  function call(reducer: string, args: unknown) {
    return new Promise<void>((resolve, reject) => {
      const send = () => {
        if (!active) { reject(new Error("Connection closed")); return; }
        let error: unknown = null;
        let commit: Commit | null = null;
        const stop = world.onCommit(entry => { commit = entry; });
        try { player.call(reducer, args ?? {}); } catch (failure) { error = failure; } finally { stop(); }
        calls.push({ reducer, args, error: error ? (error instanceof Error ? error.message : String(error)) : null });
        const answer = () => {
          if (!error) deliver(commit);
          if (error) reject(error); else resolve();
        };
        if (options.latencyMs) setTimeout(answer, options.latencyMs); else queueMicrotask(answer);
      };
      const refusal = options.refuse?.(reducer);
      if (refusal) { calls.push({ reducer, args, error: refusal }); queueMicrotask(() => reject(new Error(refusal))); return; }
      if (holdOverride ?? options.hold) held.push(send); else send();
    });
  }
  const reducers = new Proxy({}, { get: (_target, name: string) => name === "then" ? undefined : (args: unknown) => call(name, args) });
  const procedures = new Proxy({}, {
    get: (_target, name: string) => name === "then" ? undefined : async (args: unknown) => {
      const result = player.procedure(name, args ?? {});
      await Promise.resolve();
      deliver();
      return result;
    },
  });

  function subscriptionBuilder() {
    let applied: ((ctx: unknown) => void) | null = null;
    let failed: ((ctx: unknown) => void) | null = null;
    const builder = {
      onApplied(callback: (ctx: unknown) => void) { applied = callback; return builder; },
      onError(callback: (ctx: unknown) => void) { failed = callback; return builder; },
      subscribe(queries: unknown) {
        let subscribed = true;
        const list = Array.isArray(queries) ? queries : [queries];
        for (const query of list) {
          const name = (query as { sourceName?: string; table?: { sourceName?: string } })?.sourceName ?? (query as { table?: { sourceName?: string } })?.table?.sourceName;
          const accessor = Object.values(bindings).find(table => table.sourceName === name)?.accessorName;
          if (accessor) track(accessor);
        }
        queueMicrotask(() => {
          if (!active) { failed?.({ event: new Error("Connection closed") }); return; }
          deliver();
          if (subscribed) applied?.(eventContext());
        });
        return {
          isActive: () => subscribed && active,
          isEnded: () => !subscribed,
          unsubscribe: () => { subscribed = false; },
          unsubscribeThen: (callback: () => void) => { subscribed = false; queueMicrotask(callback); },
        };
      },
      subscribeToAllTables() { for (const accessor of Object.keys(bindings)) track(accessor); return builder.subscribe([]); },
    };
    return builder;
  }

  const connection = {
    identity: player.identity,
    get connectionId() { return player.connectionId; },
    get isActive() { return active; },
    set isActive(_value: boolean) { /* guardConnectionActivity writes the SDK's flag */ },
    get isDisconnectRequested() { return disconnectRequested; },
    get isSocketClosed() { return !active; },
    db, reducers, procedures, subscriptionBuilder,
    /** Closes the socket as the player's tab would: the server's disconnect hook runs, then onDisconnect. */
    disconnect() {
      if (!active) return;
      disconnectRequested = true;
      drop();
    },
  };

  function drop(error?: Error) {
    active = false;
    stopCommits(); stopClock();
    player.disconnect();
    queueMicrotask(() => disconnectListeners.forEach(listener => listener(eventContext(), error)));
  }

  return Object.assign(connection as unknown as DbConnection, {
    /** The fake's own controls: none of these exist on a real connection. */
    fake: {
      player, deliver, calls,
      /** Lets queued microtasks and replies land. */
      settle: async (rounds = 5) => { for (let i = 0; i < rounds; i++) await Promise.resolve(); },
      /** The socket dies without the client asking (a network drop). */
      drop: (error?: Error) => { if (active) drop(error); },
      /** Row updates stop arriving (true) and then arrive all at once (false): a stalled, then bursting, network. */
      holdRows: (held: boolean) => {
        rowsHeld = held;
        if (!held && rowsMissed) { rowsMissed = false; deliver(); }
      },
      /** Releases reducer calls held by `hold`. */
      release: () => { for (const send of held.splice(0)) send(); },
      /** From now on holds reducer calls until release() (on), or sends them again (off): a stall mid-session. */
      setHold: (on: boolean) => { holdOverride = on; },
      onDisconnect: (listener: (ctx: unknown, error?: Error) => void) => { disconnectListeners.add(listener); },
      /** Every row this client sees in a table. */
      rows: (accessor: string) => rowsOf(accessor),
    },
  });
}
