import type { Identity } from "spacetimedb";
import { tables, type DbConnection } from "../../module_bindings";
import { unsubscribeIfActive, type ActiveSubscription } from "./subscription-handoff";

/** Fetch only chat senders' small profile rows, in batches, then release them.
 * Keep portrait snapshots independent of subscription row-removal events. */
export function createChatPortraits(options: {
  connection: () => DbConnection | null;
  changed: () => void;
}) {
  const cache = new Map<string, { icon: number | undefined; retryAt: number }>();
  const queued = new Map<string, { identity: Identity; attempt: number; readyAt: number }>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | null = null;

  function schedule() {
    if (cancel || !queued.size) return;
    clearTimeout(timer);
    const readyAt = Math.min(...[...queued.values()].map(request => request.readyAt));
    timer = setTimeout(() => { timer = undefined; flush(); }, Math.max(0, readyAt - Date.now()));
  }
  function flush() {
    const connection = options.connection();
    if (!connection?.isActive) {
      // A chat snapshot can arrive while the connection is still becoming ready.
      timer = setTimeout(() => { timer = undefined; flush(); }, 1_000);
      return;
    }
    const batch = [...queued.entries()].filter(([, request]) => request.readyAt <= Date.now()).slice(0, 50);
    if (!batch.length) { schedule(); return; }
    for (const [key] of batch) { queued.delete(key); pending.add(key); }
    let handle: ActiveSubscription | null = null;
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (applied: boolean, retry = true) => {
      if (settled) { unsubscribeIfActive(handle); return; }
      settled = true;
      clearTimeout(deadline);
      const current = options.connection() === connection;
      if (current) {
        const icons = new Map<string, number>();
        if (applied) for (const row of connection.db.playerProfile.iter()) {
          const key = row.identity.toHexString();
          if (pending.has(key)) icons.set(key, row.profileIcon);
        }
        for (const [key, request] of batch) {
          const icon = icons.get(key);
          const retryAt = icon === undefined ? Date.now() + 5_000 * 2 ** request.attempt : Infinity;
          cache.delete(key);
          cache.set(key, { icon, retryAt });
          // Retry without needing a message, UI render, or a full profile visit.
          // Bound automatic retries for deleted/unavailable players.
          if (icon === undefined && retry && request.attempt < 2) {
            queued.set(key, { identity: request.identity, attempt: request.attempt + 1, readyAt: retryAt });
          }
        }
        while (cache.size > 2048) cache.delete(cache.keys().next().value!);
        while (queued.size > 2048) queued.delete(queued.keys().next().value!);
      }
      for (const [key] of batch) pending.delete(key);
      cancel = null;
      unsubscribeIfActive(handle);
      if (applied && current) options.changed();
      schedule();
    };
    cancel = () => { finish(false, false); };
    try {
      handle = connection.subscriptionBuilder()
        .onApplied(() => finish(true))
        .onError(() => finish(false))
        .subscribe(batch.map(([, request]) => tables.playerProfile.where(row => row.identity.eq(request.identity))));
      if (settled) unsubscribeIfActive(handle);
      else deadline = setTimeout(() => finish(false), 10_000);
    } catch { finish(false); }
  }
  return {
    icon: (identity: string) => cache.get(identity)?.icon,
    request(identity: Identity) {
      const key = identity.toHexString();
      if ((cache.get(key)?.retryAt ?? 0) > Date.now() || pending.has(key) || queued.has(key)) return;
      queued.set(key, { identity, attempt: 0, readyAt: Date.now() });
      while (queued.size > 2048) queued.delete(queued.keys().next().value!);
      schedule();
    },
    clear() {
      queued.clear();
      cancel?.();
      clearTimeout(timer); timer = undefined;
      pending.clear(); cache.clear();
    },
  };
}
