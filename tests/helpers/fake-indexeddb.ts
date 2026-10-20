/**
 * Just enough IndexedDB for the DPoP key store: one shared "disk" per factory,
 * transactions run one at a time in the order they were opened (as readwrite
 * transactions on one store do), and requests made in a callback run in the
 * same transaction.
 */
export function fakeIndexedDB() {
  const stores = new Map<string, Map<IDBValidKey, unknown>>();
  let queue = Promise.resolve();
  type Request = { result?: unknown; error: null; onsuccess: (() => void) | null; onerror: (() => void) | null };
  const request = (): Request => ({ error: null, onsuccess: null, onerror: null });

  function transaction(names: string | string[]) {
    const name = Array.isArray(names) ? names[0] : names;
    const work: Array<() => void> = [];
    const tx = {
      error: null, oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null,
      objectStore: () => ({
        get(key: IDBValidKey) { const r = request(); work.push(() => { r.result = stores.get(name)!.get(key); r.onsuccess?.(); }); return r; },
        put(value: unknown, key: IDBValidKey) { const r = request(); work.push(() => { stores.get(name)!.set(key, value); r.onsuccess?.(); }); return r; },
      }),
    };
    queue = queue.then(() => { while (work.length) work.shift()!(); tx.oncomplete?.(); });
    return tx;
  }

  const factory = {
    open() {
      const r = { ...request(), onupgradeneeded: null as (() => void) | null };
      queueMicrotask(() => {
        r.result = {
          objectStoreNames: { contains: (store: string) => stores.has(store) },
          createObjectStore: (store: string) => { stores.set(store, new Map()); },
          transaction, close() {},
        };
        if (!stores.size) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
  return { indexedDB: factory as unknown as IDBFactory, clear: () => stores.forEach(store => store.clear()) };
}
