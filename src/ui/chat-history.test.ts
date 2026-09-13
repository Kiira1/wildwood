import { expect, it, vi } from "vitest";
import { createChatHistory } from "./chat-history";
import { chatPage } from "../../shared/chat-page";
const rows = (start: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: BigInt(start + i) }));

it("loads 50 at a time without duplicates while new messages arrive", async () => {
  const history = createChatHistory<{ id: bigint }>();
  history.select("me:public");
  const live = rows(151, 50);
  history.messages(live);
  const fetch = vi.fn(async (before: bigint) => {
    const page = chatPage(rows(1, 200), before);
    return { ...page, beforeId: page.messages[0]?.id ?? before };
  });
  await history.load(fetch, live);
  expect(fetch).toHaveBeenLastCalledWith(151n);
  expect(history.messages(rows(1000, 50))).toEqual(rows(101, 100));
  await history.load(fetch, live);
  expect(history.messages(live)).toEqual(rows(51, 150));
  await history.load(fetch, live);
  expect(history.messages(live)).toEqual(rows(1, 200));
  expect(history.state().hasMore).toBe(false);
  await history.load(fetch, live);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("deduplicates concurrent scroll requests and rejects late history from another conversation", async () => {
  const history = createChatHistory<{ id: bigint }>();
  history.select("me:guild:1");
  let resolve!: (page: { messages: { id: bigint }[]; beforeId: bigint; hasMore: boolean }) => void;
  const fetch = vi.fn(() => new Promise<Parameters<typeof resolve>[0]>(done => { resolve = done; }));
  const pending = history.load(fetch, rows(51, 50));
  expect(await history.load(fetch, rows(51, 50))).toBe(false);
  history.select("me:guild:2");
  resolve({ messages: rows(1, 50), beforeId: 1n, hasMore: false });
  expect(await pending).toBe(false);
  expect(history.messages([])).toEqual([]);
  expect(history.state().loading).toBe(false);
});
it("allows retry after failure and advances past an entirely blocked page", async () => {
  const history = createChatHistory<{ id: bigint }>();
  history.select("me:public");
  await expect(history.load(async () => { throw new Error("offline"); }, rows(151, 50))).rejects.toThrow("offline");
  expect(history.state().loading).toBe(false);
  await history.load(async () => ({ messages: [], hasMore: true, beforeId: 101n }), rows(151, 50));
  const fetch = vi.fn(async () => ({ messages: rows(51, 50), hasMore: true, beforeId: 51n }));
  await history.load(fetch, rows(151, 50));
  expect(fetch).toHaveBeenCalledWith(101n);
});
