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
  const queued = new Map<string, Identity>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | null = null;

  function schedule() {
    if (timer !== undefined || cancel || !queued.size) return;
    timer = setTimeout(() => { timer = undefined; flush(); }, 0);
  }
  function flush() {
    const connection = options.connection();
    if (!connection?.isActive) { queued.clear(); return; }
    const batch = [...queued.entries()].slice(0, 50);
    for (const [key] of batch) { queued.delete(key); pending.add(key); }
    let handle: ActiveSubscription | null = null;
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (applied: boolean) => {
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
        for (const [key] of batch) {
          const icon = icons.get(key);
          cache.delete(key);
          cache.set(key, { icon, retryAt: icon === undefined ? Date.now() + 5_000 : Infinity });
        }
        while (cache.size > 2048) cache.delete(cache.keys().next().value!);
      }
      for (const [key] of batch) pending.delete(key);
      cancel = null;
      unsubscribeIfActive(handle);
      if (applied && current) options.changed();
      schedule();
    };
    cancel = () => { finish(false); };
    try {
      handle = connection.subscriptionBuilder()
        .onApplied(() => finish(true))
        .onError(() => finish(false))
        .subscribe(batch.map(([, identity]) => tables.playerProfile.where(row => row.identity.eq(identity))));
      if (settled) unsubscribeIfActive(handle);
      else deadline = setTimeout(() => finish(false), 10_000);
    } catch { finish(false); }
  }
  return {
    icon: (identity: string) => cache.get(identity)?.icon,
    request(identity: Identity) {
      const key = identity.toHexString();
      if ((cache.get(key)?.retryAt ?? 0) > Date.now() || pending.has(key) || !options.connection()?.isActive) return;
      queued.set(key, identity);
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
