import { afterEach, expect, it, vi } from "vitest";
import { Identity } from "spacetimedb";
import { createPlayerProfileService } from "./player-profile-service";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture() {
  vi.stubGlobal("window", globalThis);
  const subscriptions: Array<{ apply: () => void; unsubscribe: ReturnType<typeof vi.fn> }> = [];
  const connection = {
    isActive: true,
    procedures: { getLeaderboardPage: vi.fn() },
    db: Object.fromEntries(["playerProgress", "playerLifetime", "playerResearch", "playerItemUpgrade", "playerProfile", "playerAccountStatus", "player"].map(name => [name, { iter: () => [] }])),
    subscriptionBuilder() {
      let applied = () => {}, ready = false;
      const unsubscribe = vi.fn(() => { if (!ready) throw new Error("Cannot unsubscribe pending"); });
      const builder = {
        onApplied(callback: () => void) { applied = callback; return builder; },
        onError() { return builder; },
        subscribe() {
          subscriptions.push({ apply() { ready = true; applied(); }, unsubscribe });
          return { unsubscribe, isActive: () => ready, isEnded: () => false };
        },
      };
      return builder;
    },
  };
  const service = createPlayerProfileService({ connection: () => connection, localIdentity: () => "me", notify: vi.fn(),
    localMapId: () => "tutorial_forest", nearbyMapFor: () => undefined, developerIdentityFor: () => undefined,
    directory: { identityFor: () => new Identity("1".repeat(64)), tables: {}, rememberPresentation: vi.fn() },
    progression: { progressFor: () => null, lifetimeFor: () => null, clearProfile: vi.fn(), tables: {} },
  } as never);
  return { service, subscriptions, connection };
}
it("closes a pending profile without throwing and disposes it when it finally applies", async () => {
  const f = fixture();
  const pending = f.service.api.loadPlayerProfile("friend");
  expect(() => f.service.api.releasePlayerProfile()).not.toThrow();
  expect(await pending).toBeNull();
  expect(f.subscriptions[0].unsubscribe).not.toHaveBeenCalled();
  f.subscriptions[0].apply();
  expect(f.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
});
it("an old response cannot replace a reopened profile for the same player", async () => {
  const f = fixture();
  const first = f.service.api.loadPlayerProfile("friend");
  f.service.api.releasePlayerProfile();
  const second = f.service.api.loadPlayerProfile("friend");
  f.subscriptions[0].apply();
  expect(f.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
  expect(f.subscriptions[1].unsubscribe).not.toHaveBeenCalled();
  f.subscriptions[1].apply();
  expect(await first).toBeNull(); expect(await second).toBeNull();
});
it("a stalled profile request times out safely and still disposes a late subscription", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const pending = f.service.api.loadPlayerProfile("friend");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await pending).toBeNull();
  f.subscriptions[0].apply();
  expect(f.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
});

it("deduplicates leaderboard pages and rejects a late page after the session is cleared", async () => {
  const f = fixture();
  let finish!: (page: unknown) => void;
  f.connection.procedures.getLeaderboardPage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = f.service.api.loadLeaderboardPage("power", 250, 100);
  const duplicate = f.service.api.loadLeaderboardPage("power", 250, 100);
  expect(first).toBe(duplicate);
  expect(f.connection.procedures.getLeaderboardPage).toHaveBeenCalledOnce();
  f.service.clearSession();
  const rejected = expect(first).rejects.toThrow("Session changed");
  finish({ entries: [], startRank: 250, endRank: 349, localRank: 300, total: 1000 });
  await rejected;
});
