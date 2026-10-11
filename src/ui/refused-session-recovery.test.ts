vi.mock("../coop/services/connection-diagnostic-runtime", () => ({ recordConnectionDiagnostic: vi.fn() }));
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRefusedSessionRecovery, REFUSED_SESSION_RECONNECTS_BEFORE_RELOAD, REFUSED_SESSION_RETRY_BASE_MS, REFUSED_SESSION_RETRY_MAX_MS,
} from "./refused-session-recovery";
import { STALE_SESSION_RELOAD_AFTER_MS, STALE_SESSION_RELOAD_COOLDOWN_MS } from "../app/version";

function policy(options: { reconnect?: () => boolean; reload?: (blockedForMs: number) => boolean } = {}) {
  let now = 1_000_000;
  const reconnect = vi.fn(options.reconnect ?? (() => true));
  const reload = vi.fn(options.reload ?? ((_blockedForMs: number) => false));
  const recovery = createRefusedSessionRecovery({ now: () => now, reconnect, reload });
  /** Ticks every 5 s, as the coordinator does, for `ms`. */
  const run = (ms: number, updating = true, connected = false) => {
    for (let t = 0; t < ms; t += 5_000) { now += 5_000; recovery.tick(updating, connected); }
  };
  return { reconnect, reload, recovery, run, now: () => now };
}

describe("a refused session on a current build", () => {
  it("leaves a healthy connection alone", () => {
    const p = policy();
    p.run(60 * 60_000, false, true);
    expect(p.reconnect).not.toHaveBeenCalled();
    expect(p.reload).not.toHaveBeenCalled();
  });

  it("opens a fresh connection once a newer deploy has had its grace, not before", () => {
    const p = policy();
    // The first tick that sees the refusal starts the clock.
    p.run(STALE_SESSION_RELOAD_AFTER_MS);
    expect(p.reconnect).not.toHaveBeenCalled();
    p.run(5_000);
    expect(p.reconnect).toHaveBeenCalledOnce();
  });

  it("backs off between refused fresh connections, then reloads", () => {
    const p = policy({ reload: () => true });
    const at: number[] = [];
    p.reconnect.mockImplementation(() => { at.push(p.now()); return true; });
    p.run(STALE_SESSION_RELOAD_AFTER_MS + 2 * 60_000);
    expect(at).toHaveLength(REFUSED_SESSION_RECONNECTS_BEFORE_RELOAD);
    expect(at[1] - at[0]).toBe(REFUSED_SESSION_RETRY_BASE_MS);
    expect(at[2] - at[1]).toBe(REFUSED_SESSION_RETRY_BASE_MS * 2);
    expect(p.reload).toHaveBeenCalled();
    expect(p.reload.mock.calls[0][0]).toBeGreaterThanOrEqual(STALE_SESSION_RELOAD_AFTER_MS);
  });

  it("never loops hot, whatever the server answers", () => {
    // Reload never allowed: a fresh connection at most once a minute after the first few.
    const p = policy();
    const at: number[] = [];
    p.reconnect.mockImplementation(() => { at.push(p.now()); return true; });
    p.run(60 * 60_000);
    const gaps = at.slice(1).map((time, index) => time - at[index]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(REFUSED_SESSION_RETRY_BASE_MS);
    expect(Math.min(...gaps.slice(REFUSED_SESSION_RECONNECTS_BEFORE_RELOAD))).toBeGreaterThanOrEqual(REFUSED_SESSION_RETRY_MAX_MS);
    expect(at.length).toBeLessThanOrEqual(REFUSED_SESSION_RECONNECTS_BEFORE_RELOAD + 60);
  });

  it("keeps its count across a fresh connection that is refused again, and resets on a healthy one", () => {
    const p = policy();
    p.run(STALE_SESSION_RELOAD_AFTER_MS + 5_000);
    expect(p.reconnect).toHaveBeenCalledOnce();
    p.run(5_000, false, false); // the fresh connection is in flight
    p.run(REFUSED_SESSION_RETRY_BASE_MS); // and is refused again
    expect(p.reconnect).toHaveBeenCalledTimes(2);
    p.run(5_000, false, true); // this one came back
    p.reconnect.mockClear();
    p.run(STALE_SESSION_RELOAD_AFTER_MS);
    expect(p.reconnect).not.toHaveBeenCalled();
  });

  it("reloads a tab that cannot reconnect now (hidden), as before", () => {
    const p = policy({ reconnect: () => false, reload: () => true });
    p.run(STALE_SESSION_RELOAD_AFTER_MS + 5_000);
    expect(p.reload).toHaveBeenCalledOnce();
  });
});

describe("the startup coordinator with a refused session", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  async function setup(liveVersion: string, data = new Map<string, string>()) {
    vi.resetModules(); // a fresh page
    if (!vi.isFakeTimers()) vi.useFakeTimers();
    const replace = vi.fn();
    vi.stubGlobal("window", {
      location: { href: "https://example.test/game", replace },
      history: { replaceState: vi.fn() },
      setTimeout, setInterval, clearTimeout, clearInterval,
    });
    vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn() });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      removeItem: (key: string) => { data.delete(key); },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ version: liveVersion }) })));
    const { createStartupCoordinator } = await import("./startup-coordinator");
    const account = { signedIn: true, updating: true };
    let connected = false;
    const order: string[] = [];
    const retryRefusedSession = vi.fn(() => { order.push("reconnect"); return true; });
    const retryConnection = (refusedSession?: boolean) => refusedSession ? retryRefusedSession() : true;
    const beforeReload = vi.fn(async () => { order.push("beforeReload"); return true; });
    replace.mockImplementation(() => order.push("navigate"));
    const gameUpdateGate = { hidden: true } as HTMLElement;
    const coordinator = createStartupCoordinator({
      version: "0.901.50", gameUpdateGate, accountState: () => account,
      pageLoadComplete: () => true, playerSpriteReady: () => true, worldArtReady: () => true,
      refreshLoading: () => {}, restartLoading: () => {}, showSessionConflict: () => {}, legalConsentAccepted: () => true,
      showLegalGate: () => {}, showAccountChoice: () => {}, showAccountAction: () => {}, showConnectionFailure: () => {},
      showLoading: () => {}, showNewPlayerIntro: () => {}, hideStart: () => {}, isLoadingSequenceComplete: () => true,
      hasStarted: () => true, isRunning: () => true, connected: () => connected, progressLoaded: () => true,
      hasLocalState: () => true, localProfileReady: () => true, startupKind: () => "returning",
      beginAdventure: () => {}, startGame: () => {}, retryConnection,
      prepareUpdateReload: () => true,
      updateHandoff: { canReload: () => true, beforeReload },
    });
    coordinator.updateProtocolGate(account);
    coordinator.startVersionPolling();
    return { coordinator, account, gameUpdateGate, replace, retryRefusedSession, beforeReload, order, data,
      reconnected: () => { account.updating = false; connected = true; coordinator.updateProtocolGate(account); } };
  }

  it("reconnects when no newer build is live, and drops the update screen once the session is back", async () => {
    const s = await setup("0.901.50");
    expect(s.gameUpdateGate.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(STALE_SESSION_RELOAD_AFTER_MS + 5_000);
    expect(s.retryRefusedSession).toHaveBeenCalledOnce();
    expect(s.replace).not.toHaveBeenCalled();
    s.reconnected();
    expect(s.gameUpdateGate.hidden).toBe(true);
    expect(s.coordinator.state().value).toBe("running");
  });

  it("still takes the update path when a newer build is live", async () => {
    const s = await setup("0.901.51");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(s.retryRefusedSession).not.toHaveBeenCalled();
    expect(s.beforeReload).toHaveBeenCalledWith("0.901.51");
    expect(s.replace).toHaveBeenCalledWith("https://example.test/game?v=0.901.51");
    // A real update keeps its screen even if the account flag drops.
    s.reconnected();
    expect(s.gameUpdateGate.hidden).toBe(false);
  });

  it("falls back to one reload, after the save handoff, and not again inside the cooldown", async () => {
    const data = new Map<string, string>();
    const first = await setup("0.901.50", data);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(first.retryRefusedSession).toHaveBeenCalledTimes(REFUSED_SESSION_RECONNECTS_BEFORE_RELOAD);
    expect(first.replace).toHaveBeenCalledOnce();
    expect(first.replace).toHaveBeenCalledWith("https://example.test/game?v=0.901.50");
    expect(first.order.indexOf("beforeReload")).toBeLessThan(first.order.indexOf("navigate"));

    // The reloaded page is refused again: it keeps reconnecting, but may not reload inside the cooldown.
    const second = await setup("0.901.50", data);
    await vi.advanceTimersByTimeAsync(STALE_SESSION_RELOAD_COOLDOWN_MS - 2 * 60_000 - 5_000);
    expect(second.retryRefusedSession.mock.calls.length).toBeGreaterThan(REFUSED_SESSION_RECONNECTS_BEFORE_RELOAD);
    expect(second.replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(second.replace).toHaveBeenCalledOnce();
  });
});
