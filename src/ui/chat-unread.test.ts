import { describe, expect, it } from "vitest";
import { createChatUnreadTracker, formatChatUnreadCount } from "./chat-unread";
const row = (id: bigint, sentAtMs = 101, sender = "friend") => ({ id, sentAtMs, sender });

describe("chat unread tracking", () => {
  it("ignores initial and delayed historical hydration, then counts incoming IDs only once", () => {
    const tracker = createChatUnreadTracker(100);
    expect(tracker.refresh("me", [row(1n)], new Map(), null).guild).toBe(0);
    expect(tracker.refresh("me", [row(1n), row(2n, 90)], new Map(), null).guild).toBe(0);
    expect(tracker.refresh("me", [row(1n), row(2n, 90), row(3n)], new Map(), null).guild).toBe(1);
    expect(tracker.refresh("me", [row(1n), row(2n, 90), row(3n)], new Map(), null).guild).toBe(1);
  });
  it("keeps other private conversations unread when one conversation is read", () => {
    const tracker = createChatUnreadTracker(100);
    tracker.refresh("me", [], new Map(), null);
    const rows = new Map([["friend", [row(1n)]], ["other", [row(2n, 101, "other")]]]);
    const incoming = tracker.refresh("me", [], rows, null);
    expect(incoming.private).toBe(2);
    expect(incoming.conversations.get("other")).toBe(1);
    expect(tracker.refresh("me", [], rows, "private:friend").private).toBe(1);
    expect(tracker.refresh("me", [], rows, "private:other").private).toBe(0);
  });
  it("ignores own messages, retains unread counts as live rows roll off, and resets sessions", () => {
    const tracker = createChatUnreadTracker(100);
    tracker.refresh("me", [], new Map(), null);
    expect(tracker.refresh("me", [row(1n, 101, "me"), row(2n)], new Map(), null).guild).toBe(1);
    expect(tracker.refresh("me", [], new Map(), null).guild).toBe(1);
    tracker.reset(200);
    expect(tracker.refresh("other-account", [row(2n)], new Map(), null).guild).toBe(0);
  });
});

it("counts world and social IDs independently and clears only the channel being read", () => {
  const tracker = createChatUnreadTracker(100);
  tracker.refresh("me", [], new Map(), null);
  const privateRows = new Map([["friend", [row(1n)]]]);
  const counts = tracker.refresh("me", [row(1n)], privateRows, null, [row(1n)]);
  expect([counts.world, counts.guild, counts.private]).toEqual([1, 1, 1]);
  const readingWorld = tracker.refresh("me", [row(1n)], privateRows, "world", [row(1n)]);
  expect([readingWorld.world, readingWorld.guild, readingWorld.private]).toEqual([0, 1, 1]);
});

it("counts over 99 arrivals without retaining their rows or recounting loaded history", () => {
  const tracker = createChatUnreadTracker(100);
  tracker.refresh("me", [], new Map(), null);
  for (let id = 1n; id <= 120n; id++) tracker.refresh("me", [], new Map(), null, [row(id)]);
  const counts = tracker.refresh("me", [], new Map(), null, [row(1n), row(120n)]);
  expect(counts.world).toBe(120);
  expect(formatChatUnreadCount(counts.world)).toBe("+99");
  expect(formatChatUnreadCount(99)).toBe("99");
  expect(formatChatUnreadCount(1)).toBe("1");
  expect(formatChatUnreadCount(0)).toBe("");
  expect(tracker.refresh("me", [], new Map(), "world").world).toBe(0);
});

it("drops the previous guild count and quietly hydrates a newly joined guild", () => {
  const tracker = createChatUnreadTracker(100);
  tracker.refresh("me", [], new Map(), null);
  expect(tracker.refresh("me", [row(1n)], new Map(), null).guild).toBe(1);
  tracker.resetGuild();
  expect(tracker.refresh("me", [row(10n)], new Map(), null).guild).toBe(0);
  expect(tracker.refresh("me", [row(10n), row(11n)], new Map(), null).guild).toBe(1);
});
