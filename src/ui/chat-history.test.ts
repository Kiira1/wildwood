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
it("jumps directly to a bounded page around an original and keeps newer traffic separate", async () => {
  const history = createChatHistory<{ id: bigint }>();
  history.select("me:public");
  history.messages(rows(951, 50));
  const fetch = vi.fn(async () => ({ messages: rows(101, 50), beforeId: 101n, hasMore: true }));
  expect(await history.seek(fetch, 150n)).toBe(true);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(151n);
  expect(history.messages(rows(1001, 50))).toEqual(rows(101, 50));
  expect(history.state()).toMatchObject({ frozen: true, detached: true });
  await history.load(async () => ({ messages: rows(1001, 50), beforeId: 1001n, hasMore: true }), [], true);
  expect(history.state().detached).toBe(false);
  expect(history.messages([])).toEqual(rows(1001, 50));
});
it("leaves the current conversation intact when the original is missing or its request fails", async () => {
  const history = createChatHistory<{ id: bigint }>();
  history.select("me:public");
  history.messages(rows(951, 50));
  expect(await history.seek(async () => ({ messages: rows(1, 20), beforeId: 1n, hasMore: false }), 25n)).toBe(false);
  await expect(history.seek(async () => { throw new Error("offline"); }, 25n)).rejects.toThrow("offline");
  expect(history.messages([])).toEqual(rows(951, 50));
  expect(history.state()).toMatchObject({ loading: false, detached: false });
});
it("discards an original lookup after switching conversations", async () => {
  const history = createChatHistory<{ id: bigint }>();
  history.select("me:dm:first");
  let resolve!: (page: { messages: { id: bigint }[]; beforeId: bigint; hasMore: boolean }) => void;
  const pending = history.seek(() => new Promise(done => { resolve = done; }), 25n);
  history.select("me:dm:second");
  resolve({ messages: rows(1, 25), beforeId: 1n, hasMore: false });
  expect(await pending).toBe(false);
  expect(history.messages([])).toEqual([]);
  expect(history.state()).toMatchObject({ loading: false, detached: false });
});

it("bounds the history cache without claiming a continuous path to latest after eviction", async () => {
  const history = createChatHistory<{ id: bigint }>(); history.select("me:public");
  const live = rows(951, 50);
  const fetch = async (before: bigint) => ({ messages: rows(Number(before) - 50, 50), beforeId: before - 50n, hasMore: true });
  for (let i = 0; i < 15; i++) {
    await history.load(fetch, live);
    expect(history.messages(live).length).toBeLessThanOrEqual(500);
  }
  expect(history.state().detached).toBe(true);
  expect(history.messages(live)[0].id).toBe(201n);
  await history.load(async () => ({ messages: live, beforeId: 951n, hasMore: true }), live, true);
  expect(history.state().detached).toBe(false);
  expect(history.messages(live)).toEqual(live);
});
