import { schema as sdkSchema, table, t } from "spacetimedb";

// Node cannot load the host-only `spacetime:sys` imports. Keep the real SDK
// table/type builders, replacing only export registration, not reducer logic.
// Reducer callbacks are executed by the in-memory transaction harness.
export { table, t };
export class SenderError extends Error {}

export const reducerParameters = new WeakMap<Function, Record<string, unknown>>();
/** Every view by its table name, as a client subscribes to it (tests/scenarios reads these). */
export const registeredViews = new Map<string, { callback: Function; anonymous: boolean }>();

/** Views declared without a name: the host names them after their export (see nameViewsByExport). */
const unnamedViews = new Map<Function, boolean>();

/** Registers the unnamed views under their export's table name, as the host does ("myChat" → "my_chat"). */
export function nameViewsByExport(exports: Record<string, unknown>) {
  for (const [name, value] of Object.entries(exports)) {
    if (typeof value !== "function" || !unnamedViews.has(value)) continue;
    const table = name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    if (!registeredViews.has(table)) registeredViews.set(table, { callback: value, anonymous: unnamedViews.get(value)! });
  }
}

/** Scheduled tables by accessor: the reducer each due row runs (tests/scenarios runs them). */
export const scheduledTables = new Map<string, () => Function>();

export function schema(tables: Parameters<typeof sdkSchema>[0]) {
  for (const [accessor, definition] of Object.entries(tables as Record<string, any>)) {
    if (definition?.schedule?.reducer) scheduledTables.set(accessor, definition.schedule.reducer);
  }
  function register(...args: any[]) {
    const callback = args[args.length - 1];
    if (typeof callback !== "function") throw new Error("Expected a reducer/view callback");
    reducerParameters.set(callback, args.length === 2 ? args[0] : {});
    return callback;
  }
  const registerView = (anonymous: boolean) => (...args: any[]) => {
    const callback = register(...args);
    if (typeof args[0]?.name === "string") registeredViews.set(args[0].name, { callback, anonymous });
    else unnamedViews.set(callback, anonymous);
    return callback;
  };
  return {
    ...sdkSchema(tables),
    clientVisibilityFilter: { sql: (query: string) => query },
    reducer: register,
    procedure: register,
    httpHandler: register,
    httpRouter: (router: unknown) => router,
    clientConnected: register,
    clientDisconnected: register,
    view: registerView(false),
    anonymousView: registerView(true),
  };
}

export class Router {
  get(_path: string, _handler: unknown) { return this; }
}
export class SyncResponse {
  status: number;
  headers: Headers;
  constructor(private body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
    this.status = init.status ?? 200; this.headers = new Headers(init.headers);
  }
  text() { return this.body; }
}

// Host-only server runtime is replaced above. Match the SDK Range public shape
// so real reducer helpers can exercise indexed range reads in Node tests.
export class Range<T> {
  readonly from: { tag: "unbounded" } | { tag: "included" | "excluded"; value: T };
  readonly to: { tag: "unbounded" } | { tag: "included" | "excluded"; value: T };
  constructor(from?: Range<T>["from"], to?: Range<T>["to"]) {
    this.from = from ?? { tag: "unbounded" }; this.to = to ?? { tag: "unbounded" };
  }
}
