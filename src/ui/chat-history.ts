type Message = { id: bigint };
export type ChatHistoryPage<T> = { messages: T[]; hasMore: boolean; beforeId: bigint };
const merge = <T extends Message>(a: T[], b: T[]) => [...new Map([...a, ...b].map(row => [row.id, row])).values()]
  .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Cursor pages are isolated to one conversation/session. Live traffic cannot evict history being read. */
export function createChatHistory<T extends Message>() {
  let context = "", generation = 0, revision = 0, loading = false, frozen = false, hasMore = true;
  let rows: T[] = [], cursor = 0n;
  function select(key: string) {
    if (key === context) return;
    context = key; generation++; revision++; loading = false; frozen = false; hasMore = true; rows = []; cursor = 0n;
  }
  function messages(live: T[]) {
    rows = frozen ? rows.map(row => live.find(current => current.id === row.id) ?? row) : merge(rows, live).slice(-50);
    return rows;
  }
  function freeze(live: T[]) { messages(live); frozen = true; }
  async function load(fetch: (before: bigint) => Promise<ChatHistoryPage<T>>, live: T[], latest = false) {
    if (loading || (!latest && !hasMore)) return false;
    const attempt = generation;
    if (latest) { frozen = false; cursor = 0n; }
    else { freeze(live); cursor = cursor || rows[0]?.id || 0n; }
    loading = true; revision++;
    try {
      const page = await fetch(latest ? 0n : cursor);
      if (attempt !== generation) return false;
      rows = latest ? page.messages : merge(page.messages, rows).slice(0, 500);
      cursor = page.beforeId;
      hasMore = page.hasMore;
      revision++;
      return true;
    } finally {
      if (attempt === generation) { loading = false; revision++; }
    }
  }
  return { select, messages, freeze, load, state: () => ({ revision, loading, hasMore, frozen }) };
}
