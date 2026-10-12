import { ConnectionId, Identity, ScheduleAt, Timestamp } from "spacetimedb";
export { Identity, Timestamp };
// Only the structural metadata this harness consumes. Client/server SDK
// installs have nominally distinct BinaryReader classes, even at one version.
type Definition = {
  columns: Record<string, {
    columnMetadata: { [key: string]: unknown; isAutoIncrement?: boolean; defaultValue?: unknown };
    typeBuilder: { algebraicType: { tag: string; value?: any } };
  }>;
  resolvedIndexes: readonly { name: string; unique?: boolean; columns: readonly string[] }[];
};
type Row = Record<string, any>;
// caches: unique index name -> key -> stored row. Built on first use, kept up
// to date by insert, dropped by update/delete and by a rollback.
type State = { rows: Row[]; sequence: bigint; caches?: Map<string, Map<string, Row>> };

function copy<T>(value: T): T {
  if (value instanceof Identity || value instanceof ConnectionId || value instanceof Timestamp) return value;
  // Reducers can construct timestamps from the server's separate SDK install.
  // Preserve their getter when copying rows into this client-SDK test harness.
  if (value && typeof value === "object" && "__timestamp_micros_since_unix_epoch__" in value
    && typeof value.__timestamp_micros_since_unix_epoch__ === "bigint") {
    return new Timestamp(value.__timestamp_micros_since_unix_epoch__) as T;
  }
  // Identities too, when a reducer builds one from hex (new Identity(...)).
  if (value && typeof value === "object" && "__identity__" in value && typeof value.__identity__ === "bigint") {
    return new Identity(value.__identity__) as T;
  }
  if (value && typeof value === "object" && "__connection_id__" in value
    && typeof value.__connection_id__ === "bigint") {
    return new ConnectionId(value.__connection_id__) as T;
  }
  if (value instanceof Uint8Array) return value.slice() as T;
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])) as T;
  return value;
}

function equal(a: any, b: any): boolean {
  if (a?.toHexString && b?.toHexString) return a.toHexString() === b.toHexString();
  if (a instanceof Timestamp && b instanceof Timestamp) return a.microsSinceUnixEpoch === b.microsSinceUnixEpoch;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => equal(value, b[i]));
  return a === b;
}

/**
 * A string that two values share exactly when equal() says they are equal, or
 * null when no such string exists (plain objects compare by reference, NaN
 * equals nothing); callers then fall back to scanning.
 */
function keyOf(value: any): string | null {
  if (value?.toHexString) return `h:${value.toHexString()}`;
  if (value instanceof Timestamp) return `t:${value.microsSinceUnixEpoch}`;
  if (Array.isArray(value)) {
    const parts = value.map(keyOf);
    return parts.includes(null) ? null : `[${parts.join(",")}]`;
  }
  switch (typeof value) {
    case "string": return `s:${JSON.stringify(value)}`;
    case "bigint": return `g:${value}`;
    case "number": return Number.isNaN(value) ? null : `n:${value}`;
    case "boolean": return `b:${value}`;
    case "undefined": return "u";
    default: return value === null ? "z" : null;
  }
}
const rowKey = (row: Row, columns: readonly string[]) => keyOf(columns.map(column => row[column]));

function zero(type: any): any {
  if (type.tag === "Bool") return false;
  if (type.tag === "String") return "";
  if (type.tag === "Array") return [];
  if (/^[UI](64|128|256)$/.test(type.tag)) return 0n;
  if (type.tag === "Product") {
    const name = type.value.elements[0]?.name;
    if (name === "__identity__") return new Identity("0".repeat(64));
    if (name === "__connection_id__") return new ConnectionId(0n);
    if (name === "__timestamp_micros_since_unix_epoch__") return new Timestamp(0n);
    return Object.fromEntries(type.value.elements.map((e: any) => [e.name, zero(e.algebraicType)]));
  }
  if (type.tag === "Sum") {
    if (type.value.variants.some((v: any) => v.name === "none")) return undefined;
    return ScheduleAt.time(0n);
  }
  return 0;
}

/**
 * Timestamps order by their micros. Checked by shape: the server and the tests
 * load separate SDK installs, so a server-built Timestamp is not instanceof this one.
 */
const orderedValue = (value: any) => value && typeof value === "object" && typeof value.microsSinceUnixEpoch === "bigint" ? value.microsSinceUnixEpoch : value;

/** Schema-driven test storage; no host networking, scheduling, or production DB.
 * Supports the point/prefix indexes used by these reducers, unique constraints,
 * copy-on-read, auto-increment, and rollback. Not a replacement for a host test.
 */
export function createMemoryDatabase(moduleSchema: { schemaType: { tables: Record<string, Definition> } }) {
  const definitions = moduleSchema.schemaType.tables;
  const states: Record<string, State> = {};
  const db: Record<string, any> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    states[name] = { rows: [], sequence: 0n };
    const matches = (row: Row, columns: readonly string[], key: any) => {
      const values = Array.isArray(key) ? key : [key];
      if (values.length > columns.length) throw new Error(`Too many index keys for ${name}`);
      return values.every((value, i) => {
        if (value && typeof value === "object" && "from" in value && "to" in value) {
          const { from, to } = value;
          // Timestamps order by their micros on the server; plain `<` on the
          // objects would compare nothing and quietly return an empty range.
          const ordered = orderedValue;
          const actual = ordered(row[columns[i]]);
          return (from.tag === "unbounded" || (from.tag === "included" ? actual >= ordered(from.value) : actual > ordered(from.value))) &&
            (to.tag === "unbounded" || (to.tag === "included" ? actual <= ordered(to.value) : actual < ordered(to.value)));
        }
        return equal(row[columns[i]], value);
      });
    };
    const uniqueIndexes = definition.resolvedIndexes.filter((index) => index.unique);
    /** The key -> row map for a unique index, or null if some stored key has no exact string form. */
    const cacheFor = (index: { name: string; columns: readonly string[] }) => {
      const state = states[name];
      state.caches ??= new Map();
      let cache = state.caches.get(index.name);
      if (!cache) {
        cache = new Map();
        for (const row of state.rows) {
          const key = rowKey(row, index.columns);
          if (key === null) return null;
          cache.set(key, row);
        }
        state.caches.set(index.name, cache);
      }
      return cache;
    };
    const dropCaches = () => { states[name].caches = undefined; };
    const validate = (row: Row, except = -1) => {
      for (const index of uniqueIndexes) {
        const cache = cacheFor(index);
        const key = rowKey(row, index.columns);
        const clash = cache && key !== null
          ? (cache.get(key) ?? null) !== null && cache.get(key) !== states[name].rows[except]
          : states[name].rows.some((existing, i) => i !== except && index.columns.every((column) => equal(existing[column], row[column])));
        if (clash) throw new Error(`Duplicate unique index ${name}.${index.name}`);
      }
      for (const [column, builder] of Object.entries(definition.columns)) {
        if (!(column in row) && !Object.hasOwn(builder.columnMetadata, "defaultValue")) {
          throw new Error(`Missing required column ${name}.${column}`);
        }
      }
    };
    db[name] = {
      iter: () => copy(states[name].rows).values(),
      count: () => BigInt(states[name].rows.length),
      insert: (value: Row) => {
        const row = copy(value);
        for (const [column, builder] of Object.entries(definition.columns)) {
          if (!(column in row) && Object.hasOwn(builder.columnMetadata, "defaultValue")) row[column] = copy(builder.columnMetadata.defaultValue);
          if (builder.columnMetadata.isAutoIncrement) {
            if (row[column] === 0 || row[column] === 0n) {
              states[name].sequence++;
              row[column] = typeof row[column] === "number" ? Number(states[name].sequence) : states[name].sequence;
            } else if (BigInt(row[column]) > states[name].sequence) states[name].sequence = BigInt(row[column]);
          }
        }
        validate(row);
        states[name].rows.push(row);
        for (const [indexName, cache] of states[name].caches ?? []) {
          const key = rowKey(row, uniqueIndexes.find(index => index.name === indexName)!.columns);
          if (key === null) states[name].caches!.delete(indexName); else cache.set(key, row);
        }
        return copy(row);
      },
      delete: (row: Row) => {
        const i = states[name].rows.findIndex((current) => Object.keys(current).every((key) => equal(current[key], row[key])));
        if (i < 0) return false;
        states[name].rows.splice(i, 1);
        dropCaches();
        return true;
      },
      clear: () => { const count = BigInt(states[name].rows.length); states[name].rows = []; dropCaches(); return count; },
    };
    for (const index of definition.resolvedIndexes) {
      const scanIndex = (key: any) => states[name].rows.findIndex((row) => matches(row, index.columns, key));
      const exactKey = (key: any) => {
        const values = Array.isArray(key) ? key : [key];
        return Boolean(index.unique) && values.length === index.columns.length &&
          !values.some(value => value && typeof value === "object" && "from" in value && "to" in value);
      };
      /** Exact full-key lookups on a unique index use its cache; ranges and partial keys scan. */
      const findIndex = (key: any) => {
        const values = Array.isArray(key) ? key : [key];
        const cache = exactKey(key) ? cacheFor(index) : null;
        const lookup = cache ? keyOf(values) : null;
        if (cache === null || lookup === null) return scanIndex(key);
        const row = cache.get(lookup);
        return row ? states[name].rows.indexOf(row) : -1;
      };
      db[name][index.name] = {
        filter: (key: any) => {
          const rows = states[name].rows.filter((row) => matches(row, index.columns, key));
          // Committed B-tree range reads are sorted by indexed key. Dedicated
          // guild tests additionally model transaction-local rows appearing first.
          if ((Array.isArray(key) ? key : [key]).some(value => value && typeof value === "object" && "from" in value && "to" in value)) {
            const ordered = orderedValue;
            rows.sort((a, b) => {
              for (const column of index.columns) {
                if (ordered(a[column]) < ordered(b[column])) return -1;
                if (ordered(a[column]) > ordered(b[column])) return 1;
              }
              return 0;
            });
          }
          return copy(rows).values();
        },
        ...(index.unique ? {
          find: (key: any) => copy(states[name].rows[findIndex(key)] ?? null),
          update: (value: Row) => {
            const i = findIndex(index.columns.map((column) => value[column]));
            if (i < 0) throw new Error(`Missing row for update: ${name}.${index.name}`);
            validate(value, i);
            states[name].rows[i] = copy(value);
            dropCaches();
            return copy(value);
          },
        } : {}),
        delete: (key: any) => {
          if (exactKey(key)) {
            // One row at most: remove it and its keys rather than rebuilding.
            const i = findIndex(key);
            if (i < 0) return false;
            const [row] = states[name].rows.splice(i, 1);
            for (const [indexName, cache] of states[name].caches ?? []) {
              const k = rowKey(row, uniqueIndexes.find(unique => unique.name === indexName)!.columns);
              if (k !== null) cache.delete(k);
            }
            return true;
          }
          const before = states[name].rows.length;
          states[name].rows = states[name].rows.filter((row) => !matches(row, index.columns, key));
          if (states[name].rows.length !== before) dropCaches();
          return states[name].rows.length !== before;
        },
      };
    }
  }
  return {
    db,
    // Fixture convenience only. Runtime writes still require complete rows.
    row(name: string, overrides: Row): Row {
      const definition: Definition = definitions[name];
      if (!definition) throw new Error(`Unknown table ${name}`);
      return { ...Object.fromEntries(Object.entries(definition.columns).map(([key, builder]) => [
        key, Object.hasOwn(builder.columnMetadata, "defaultValue") ? copy(builder.columnMetadata.defaultValue) : zero(builder.typeBuilder.algebraicType),
      ])), ...overrides };
    },
    transaction<T>(action: () => T): T {
      // Stored rows are never changed in place (every write stores a fresh copy
      // and every read returns one), so the row lists alone are the snapshot.
      const snapshot: Record<string, State> = Object.fromEntries(Object.entries(states).map(([name, state]) => [name, { rows: state.rows.slice(), sequence: state.sequence }]));
      try { return action(); } catch (error) {
        for (const name of Object.keys(states)) states[name] = snapshot[name];
        throw error;
      }
    },
  };
}
