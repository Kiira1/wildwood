export const CHAT_PAGE_SIZE = 50;
export function chatPage<T extends { id: bigint }>(rows: Iterable<T>, beforeId = 0n) {
  const ordered = [...rows].filter(row => beforeId === 0n || row.id < beforeId)
    .sort((a, b) => a.id > b.id ? -1 : a.id < b.id ? 1 : 0);
  return { messages: ordered.slice(0, CHAT_PAGE_SIZE).reverse(), hasMore: ordered.length > CHAT_PAGE_SIZE };
}
