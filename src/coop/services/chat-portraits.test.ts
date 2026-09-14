import { afterEach, expect, it, vi } from "vitest";
import { Identity } from "spacetimedb";
import { createChatPortraits } from "./chat-portraits";
import { createProfileDirectory } from "./profile-directory";

afterEach(() => vi.useRealTimers());
const identity = (n: number) => Identity.fromString(n.toString(16).padStart(64, "0"));
function fixture() {
  vi.useFakeTimers();
  let rows: { identity: Identity; profileIcon: number }[] = [];
  const requests: { apply(): void; fail(): void; count: number; unsubscribe: ReturnType<typeof vi.fn> }[] = [];
  const changed = vi.fn();
  const connection = { isActive: true, db: { playerProfile: { iter: () => rows } },
    subscriptionBuilder() {
      let applied = () => {}, error = () => {}, ready = false, ended = false;
      const unsubscribe = vi.fn(() => { if (!ready) throw Error("Pending subscription"); ended = true; rows = []; });
      const builder = {
        onApplied(fn: () => void) { applied = fn; return builder; },
        onError(fn: () => void) { error = fn; return builder; },
        subscribe(queries: unknown[]) {
          requests.push({ apply() { ready = true; applied(); }, fail: () => { ended = true; error(); }, count: queries.length, unsubscribe });
          return { isActive: () => ready && !ended, isEnded: () => ended, unsubscribe };
        },
      };
      return builder;
    },
  };
  const portraits = createChatPortraits({ connection: () => connection, changed } as never);
  return { connection, portraits, requests, changed, rows(value: typeof rows) { rows = value; } };
}

it("batches duplicate senders and keeps their portraits after releasing the snapshot", async () => {
  const f = fixture();
  f.portraits.request(identity(1)); f.portraits.request(identity(1)); f.portraits.request(identity(2));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.requests).toHaveLength(1); expect(f.requests[0].count).toBe(2);
  f.rows([{ identity: identity(1), profileIcon: 17 }, { identity: identity(2), profileIcon: 42 }]);
  f.requests[0].apply();
  expect(f.requests[0].unsubscribe).toHaveBeenCalledOnce();
  expect(f.portraits.icon(identity(2).toHexString())).toBe(42);
  expect(f.changed).toHaveBeenCalledOnce();
  f.portraits.request(identity(2));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.requests).toHaveLength(1);
});

it("bounds each request to 50 senders and serializes the next batch", async () => {
  const f = fixture();
  for (let i = 1; i <= 61; i++) f.portraits.request(identity(i));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.requests).toHaveLength(1); expect(f.requests[0].count).toBe(50);
  f.requests[0].apply();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.requests[1].count).toBe(11);
  f.portraits.clear();
});

it("ignores a late response after changing accounts and disposes its handle", async () => {
  const f = fixture();
  f.portraits.request(identity(1));
  await vi.advanceTimersByTimeAsync(0);
  f.portraits.clear();
  f.rows([{ identity: identity(1), profileIcon: 42 }]); f.requests[0].apply();
  expect(f.portraits.icon(identity(1).toHexString())).toBeUndefined();
  expect(f.changed).not.toHaveBeenCalled();
  expect(f.requests[0].unsubscribe).toHaveBeenCalledOnce();
});

it("permits retry after a timed-out request and ignores its eventual response", async () => {
  const f = fixture();
  f.portraits.request(identity(1));
  await vi.advanceTimersByTimeAsync(15_000);
  f.portraits.request(identity(1));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.requests).toHaveLength(2);
  f.rows([{ identity: identity(1), profileIcon: 4 }]); f.requests[0].apply();
  expect(f.portraits.icon(identity(1).toHexString())).toBeUndefined();
  f.rows([{ identity: identity(1), profileIcon: 9 }]); f.requests[1].apply();
  expect(f.portraits.icon(identity(1).toHexString())).toBe(9);
});

it("loads chat avatars without opening a full player profile and invalidates chat rendering", async () => {
  const f = fixture();
  const markChatPresentationChanged = vi.fn();
  const directory = createProfileDirectory({ reducers: { connection: () => f.connection }, localIdentity: () => "me",
    shouldRetain: () => false, notify: vi.fn(), markChatPresentationChanged } as never);
  const sender = identity(1), key = sender.toHexString();
  directory.rememberChatSender({ identity: key, identityValue: sender, name: "Friend", isGuest: false });
  await vi.advanceTimersByTimeAsync(0);
  f.rows([{ identity: sender, profileIcon: 31 }]); f.requests[0].apply();
  expect(directory.api.profileIcon(key)).toBe(31);
  expect(markChatPresentationChanged).toHaveBeenCalledOnce();
  directory.clearSession();
  expect(directory.api.profileIcon(key)).toBe(0);
});

it("retries failed and missing portraits without another render or profile visit", async () => {
  const f = fixture();
  f.portraits.request(identity(1));
  await vi.advanceTimersByTimeAsync(0);
  f.requests[0].fail();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(f.requests).toHaveLength(2);
  f.requests[1].apply(); // A snapshot can apply without the requested row.
  await vi.advanceTimersByTimeAsync(10_000);
  expect(f.requests).toHaveLength(3);
  f.rows([{ identity: identity(1), profileIcon: 31 }]);
  f.requests[2].apply();
  expect(f.portraits.icon(identity(1).toHexString())).toBe(31);
  expect(f.changed).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.requests).toHaveLength(3);
});

it("waits for connection readiness and cancels queued retries on session cleanup", async () => {
  const f = fixture();
  f.connection.isActive = false;
  f.portraits.request(identity(1));
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.requests).toHaveLength(0);
  f.connection.isActive = true;
  await vi.advanceTimersByTimeAsync(1_000);
  f.requests[0].fail();
  f.portraits.clear();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.requests).toHaveLength(1);
});

it("bounds automatic retries when a player's profile is unavailable", async () => {
  const f = fixture();
  f.portraits.request(identity(1));
  await vi.advanceTimersByTimeAsync(0);
  f.requests[0].fail();
  await vi.advanceTimersByTimeAsync(5_000);
  f.requests[1].fail();
  await vi.advanceTimersByTimeAsync(10_000);
  f.requests[2].fail();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.requests).toHaveLength(3);
});
