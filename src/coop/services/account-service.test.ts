import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountService } from "./account-service";
import { createUpdateResumeStore } from "./update-resume-store";
import { inspectSpacetimeIdToken } from "../security/oidc-id-token";
import { SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../../shared/rules";
import { createDpop, DPOP_SWITCH_KEY, type DeviceDpop } from "./account-dpop";
import { fakeIndexedDB } from "../../../tests/helpers/fake-indexeddb";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

class FakeTokenRequest {
  timeout = 0;
  status: number;
  responseText: string;
  onload: ((event: ProgressEvent) => void) | null = null;
  onerror: ((event: ProgressEvent) => void) | null = null;
  ontimeout: ((event: ProgressEvent) => void) | null = null;
  onabort: ((event: ProgressEvent) => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();

  constructor(status = 200, response: unknown = {}, autoLoad = true) {
    this.status = status;
    this.responseText = JSON.stringify(response);
    if (autoLoad) this.send.mockImplementation(() => queueMicrotask(() => this.onload?.({} as ProgressEvent)));
  }
}

function stubTokenRequest(request: FakeTokenRequest) {
  vi.stubGlobal("XMLHttpRequest", vi.fn(function XMLHttpRequestMock() { return request; }));
}

const keys = {
  tokenKey: "token",
  guestTokenKey: "guest-token",
  accountTokenKey: "account-token",
  accountLinkKey: "account-link",
  loginMoveKey: "login-move",
  accountMigrationPendingKey: "migration",
  authStateKey: "auth-state",
  authVerifierKey: "auth-verifier",
  authNonceKey: "auth-nonce",
  authTripKey: "auth-trip",
  authRetryKey: "auth-retry",
  knownAccountKey: "known-account",
  knownAccountCharacterKey: "known-account-character",
  knownAccountGenderKey: "known-account-gender",
  knownGuestCharacterKey: "known-guest-character",
  authReturnUiKey: "auth-return",
  authTabKey: "auth-tab",
  legalConsentKey: "legal-consent",
};
const refreshKey = `${keys.accountTokenKey}:refresh`;

function encodeJson(value: unknown) {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function accountToken(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1_000);
  return `${encodeJson({ alg: "RS256", kid: "test-key", typ: "JWT" })}.${encodeJson({
    iss: SPACETIME_AUTH_ISSUER,
    aud: SPACETIME_AUTH_CLIENT_ID,
    sub: "account-subject",
    iat: now - 30,
    exp: now + 3_600,
    nonce: "expected-nonce",
    ...overrides,
  })}.c2lnbmF0dXJl`;
}

const expiredToken = () => accountToken({ iat: Math.floor(Date.now() / 1000) - 7_200, exp: Math.floor(Date.now() / 1000) - 60 });

function setup(options: {
  accountToken?: string;
  guestToken?: string;
  knownAccount?: boolean;
  signedIn?: boolean;
  authCallback?: boolean;
  dpop?: DeviceDpop;
} = {}) {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  if (options.accountToken) local.setItem(keys.accountTokenKey, options.accountToken);
  if (options.guestToken) local.setItem(keys.guestTokenKey, options.guestToken);
  if (options.knownAccount) local.setItem(keys.knownAccountKey, "true");
  if (options.authCallback) {
    session.setItem(keys.authStateKey, "expected-state");
    session.setItem(keys.authVerifierKey, "expected-verifier");
    session.setItem(keys.authNonceKey, "expected-nonce");
    session.setItem(keys.authReturnUiKey, "true");
  }
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  const assign = vi.fn();
  vi.stubGlobal("window", {
    location: {
      href: options.authCallback
        ? "https://wildstat.example/game?code=authorization-code&state=expected-state"
        : "https://wildstat.example/game",
      origin: "https://wildstat.example",
      pathname: "/game",
      assign,
      reload: vi.fn(),
    },
  });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  const connect = vi.fn();
  const restartConnectionForIdentityChange = vi.fn();
  const requestWorldEntry = vi.fn(async () => true);
  const disconnect = vi.fn();
  let connection = options.signedIn ? { isActive: true, reducers: { enterWorldWithTutorial: vi.fn(async () => {}) }, disconnect } : null;
  let worldEntryBlocked = false;
  const setWorldEntryBlocked = vi.fn((blocked: boolean) => { worldEntryBlocked = blocked; });
  const drainPendingProgress = vi.fn(async () => true);
  const clearPendingProgress = vi.fn();
  const service = createAccountService({
    keys,
    updateResumeMode: null,
    updateResumeStore: createUpdateResumeStore(session, "update-resume"),
    notify: vi.fn(),
    connection: () => connection as never,
    connectedSignedIn: () => Boolean(options.signedIn),
    hydrationReady: () => false,
    protocolBlocked: () => false,
    protocolReady: () => true,
    updating: () => false,
    worldEntryBlocked: () => worldEntryBlocked,
    setWorldEntryBlocked,
    requestWorldEntry,
    connect,
    restartConnectionForIdentityChange,
    scheduleReconnect: () => {},
    runWorldReducer: async (reducer) => reducer(),
    handleFailure: vi.fn(),
    errorMessage: (error) => String(error),
    localIdentity: () => "guest-identity",
    localProfileReady: () => false,
    localDisplayName: () => "",
    localGender: () => 0,
    localProgress: () => null,
    drainPendingProgress,
    clearPendingProgress,
    disconnectVirtualPlayers: vi.fn(),
    validateAccountIdToken: async (token, expectedNonce) => inspectSpacetimeIdToken(token, { expectedNonce }),
    ...(options.dpop ? { dpop: () => options.dpop! } : {}),
  });
  return { assign, connect, disconnect, local, session, requestWorldEntry, restartConnectionForIdentityChange, service,
    connection, setConnection: (value: typeof connection) => { connection = value; }, setWorldEntryBlocked,
    drainPendingProgress, clearPendingProgress };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("linking a guest save to an account", () => {
  it("claims the same guest save once after the sign-in returns", async () => {
    const f = setup({ guestToken: "existing-guest" });
    f.service.api.continueAsGuest();
    const beginAccountLink = vi.fn(async () => {}), claimGuestAccount = vi.fn(async () => {});
    const connection = { isActive: true, disconnect: vi.fn(), reducers: { beginAccountLink, claimGuestAccount } };
    f.setConnection(connection as never);
    expect(await f.service.api.signIn()).toMatchObject({ ok: true, redirecting: true });
    const link = JSON.parse(f.session.getItem(keys.accountLinkKey)!);
    expect(beginAccountLink).toHaveBeenCalledWith({ code: link.code });
    expect(f.local.getItem(keys.guestTokenKey)).toBe("existing-guest");
    const state = f.session.getItem(keys.authStateKey), nonce = f.session.getItem(keys.authNonceKey);
    window.location.href = `https://wildstat.example/game?code=verified-code&state=${state}`;
    const token = accountToken({ nonce });
    stubTokenRequest(new FakeTokenRequest(200, { id_token: token }));
    await f.service.restoreKnownAccount();
    expect(f.local.getItem(keys.accountTokenKey)).toBe(token);
    expect(f.local.getItem(keys.guestTokenKey)).toBe("existing-guest");
    expect(await f.service.claimAccountLink(connection as never, true, () => true)).toBe(true);
    expect(claimGuestAccount).toHaveBeenCalledWith({ code: link.code });
    expect(f.local.getItem(keys.guestTokenKey)).toBeNull();
    await f.service.claimAccountLink(connection as never, true, () => true);
    expect(claimGuestAccount).toHaveBeenCalledOnce();
  });

  it("does not leave for sign-in when saving the guest fails", async () => {
    const f = setup({ guestToken: "existing-guest" }), beginAccountLink = vi.fn();
    f.setConnection({ isActive: true, reducers: { beginAccountLink } } as never);
    f.drainPendingProgress.mockResolvedValue(false);
    expect(await f.service.api.signIn()).toMatchObject({ ok: false });
    expect(f.assign).not.toHaveBeenCalled();
    expect(beginAccountLink).not.toHaveBeenCalled();
    expect(f.local.getItem(keys.guestTokenKey)).toBe("existing-guest");
  });

  it("keeps the guest save when the claim is rejected, and the account when it already has progress", async () => {
    for (const error of ["Account link expired. Sign in again.", "This account already has Wildwood progress."]) {
      const existing = accountToken();
      const f = setup({ guestToken: "existing-guest", accountToken: existing, knownAccount: true, signedIn: true });
      f.session.setItem(keys.accountLinkKey, JSON.stringify({ code: "pending-link", guestIdentity: "guest-identity" }));
      const connection = { disconnect: vi.fn(), reducers: { claimGuestAccount: vi.fn().mockRejectedValue(new Error(error)) } };
      await f.service.claimAccountLink(connection as never, true, () => true);
      expect(f.local.getItem(keys.guestTokenKey)).toBe("existing-guest");
      expect(f.clearPendingProgress).not.toHaveBeenCalled();
      if (error.includes("already has")) {
        expect(f.local.getItem(keys.accountTokenKey)).toBe(existing);
        expect(connection.disconnect).not.toHaveBeenCalled();
      }
    }
  });
});

describe("the sign-in callback", () => {
  it("rejects an ID token whose nonce does not match the initiating tab", async () => {
    stubTokenRequest(new FakeTokenRequest(200, { id_token: accountToken({ nonce: "attacker-nonce" }) }));
    const { connect, local, service } = setup({ authCallback: true });
    await service.restoreKnownAccount();
    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    expect(service.api.accountState()).toMatchObject({ authInProgress: false, returningFromSignIn: false });
  });

  it("rejects a callback that names a different authorization issuer", async () => {
    stubTokenRequest(new FakeTokenRequest(200, { id_token: accountToken() }));
    const { connect, local, service } = setup({ authCallback: true });
    window.location.href = "https://wildstat.example/game?code=authorization-code&state=expected-state&iss=https%3A%2F%2Fattacker.example%2Foidc";
    await service.restoreKnownAccount();
    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  it("times out a stalled token exchange instead of verifying forever", async () => {
    const request = new FakeTokenRequest(0, {}, false);
    stubTokenRequest(request);
    const { service } = setup({ authCallback: true, knownAccount: true });
    const restore = service.restoreKnownAccount();
    await vi.waitFor(() => expect(request.send).toHaveBeenCalled());
    expect(request.timeout).toBe(15_000);
    request.ontimeout?.({} as ProgressEvent);
    await restore;
    expect(service.api.accountState()).toMatchObject({ authInProgress: false, returningFromSignIn: false });
  });

  it("asks a returning account for offline_access without forcing a new login", async () => {
    const f = setup({ knownAccount: true });
    await f.service.api.signIn();
    const url = new URL(f.assign.mock.calls[0][0]);
    expect(url.searchParams.get("prompt")).toBeNull();
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });

  it("plays on without a refresh grant rather than leaving again", async () => {
    const f = setup({ knownAccount: true });
    await f.service.api.signIn();
    const silent = new URL(f.assign.mock.calls[0][0]);
    f.session.setItem(keys.authNonceKey, "expected-nonce");
    stubTokenRequest(new FakeTokenRequest(200, { id_token: accountToken() }));
    window.location.href = `https://wildstat.example/game?code=one&state=${silent.searchParams.get("state")}`;
    await f.service.restoreKnownAccount();
    expect(f.assign).toHaveBeenCalledOnce();
    expect(f.connect).toHaveBeenCalledOnce();
  });

  it("binds the refresh grant to this device's DPoP key", async () => {
    const dpop = createDpop({ indexedDB: fakeIndexedDB().indexedDB, subtle: crypto.subtle });
    const request = new FakeTokenRequest(200, { id_token: accountToken(), refresh_token: "bound-grant", token_type: "DPoP" });
    stubTokenRequest(request);
    const f = setup({ authCallback: true, dpop });
    f.local.setItem(DPOP_SWITCH_KEY, "on");
    await f.service.restoreKnownAccount();
    expect(request.setRequestHeader.mock.calls.some(([name]) => name === "DPoP")).toBe(true);
    expect(JSON.parse(f.local.getItem(refreshKey)!)).toMatchObject({ token: "bound-grant", jkt: (await dpop.key())!.jkt });
  });
});

describe("account credentials", () => {
  it("keeps saved credentials through a temporary failure and clears them on 401", () => {
    for (const message of ["Failed to verify token: Bad Gateway", "Failed to verify token: HTTP 503 Service Unavailable", "Failed to fetch"]) {
      const token = accountToken();
      const { service, local } = setup({ accountToken: token, knownAccount: true });
      expect(service.onConnectError(true, new Error(message))).toBe(false);
      expect(local.getItem(keys.accountTokenKey)).toBe(token);
    }
    const { service, local, assign } = setup({ accountToken: accountToken(), knownAccount: true });
    expect(service.onConnectError(true, new Error("Failed to verify token: HTTP 401 Unauthorized"))).toBe(true);
    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it("retains an admitted account and its expired credential during wake recovery", () => {
    const token = accountToken({ exp: Math.floor(Date.now() / 1000) - 10 });
    const { service, local } = setup({ accountToken: token, knownAccount: true });
    service.markPlayable(true);
    expect(service.connectionCredential()).toBe(token);
    expect(service.canConnect()).toBe(true);
    expect(local.getItem(keys.accountTokenKey)).toBe(token);
  });

  it("reloads when another tab signs in a different account, not when it renews the same one", () => {
    const old = accountToken({ exp: Math.floor(Date.now() / 1000) - 10 });
    const { service } = setup({ accountToken: accountToken(), knownAccount: true });
    service.handleStorageEvent({ key: keys.accountTokenKey, oldValue: old, newValue: accountToken() } as StorageEvent);
    expect(window.location.reload).not.toHaveBeenCalled();
    service.handleStorageEvent({ key: keys.accountTokenKey, oldValue: old, newValue: accountToken({ sub: "someone-else" }) } as StorageEvent);
    expect(window.location.reload).toHaveBeenCalledOnce();
  });

  it("stores the refresh grant from a verified callback, and choosing Guest drops the account but keeps it remembered", async () => {
    const f = setup({ authCallback: true, guestToken: "guest-save" });
    stubTokenRequest(new FakeTokenRequest(200, { id_token: accountToken(), refresh_token: "refresh-grant" }));
    await f.service.restoreKnownAccount();
    expect(JSON.parse(f.local.getItem(refreshKey)!)).toMatchObject({ subject: "account-subject", token: "refresh-grant" });
    f.local.setItem(keys.knownAccountKey, "true");
    expect(f.service.api.continueAsGuest()).toEqual({ ok: true });
    expect(f.local.getItem(keys.accountTokenKey)).toBeNull();
    expect(f.local.getItem(refreshKey)).toBeNull();
    expect(f.local.getItem(keys.knownAccountKey)).toBe("true");
    expect(f.local.getItem(keys.guestTokenKey)).toBe("guest-save");
    expect(f.restartConnectionForIdentityChange).toHaveBeenCalledOnce();
  });

  it("connects a stored account on load with no Sign In tap", async () => {
    const f = setup({ accountToken: accountToken(), knownAccount: true });
    await f.service.restoreKnownAccount();
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.assign).not.toHaveBeenCalled();
    expect(f.service.canConnect()).toBe(true);
  });
});

describe("an account whose refresh grant runs out", () => {
  it("keeps a connected session playing when renewing ahead is refused", async () => {
    vi.useFakeTimers({ now: Date.now() });
    vi.stubGlobal("document", { hidden: false });
    vi.stubGlobal("navigator", { onLine: true });
    const f = setup({ accountToken: accountToken({ iat: Math.floor(Date.now() / 1000) - 3_000, exp: Math.floor(Date.now() / 1000) + 600 }), knownAccount: true, signedIn: true });
    f.local.setItem(refreshKey, JSON.stringify({ subject: "account-subject", token: "spent", savedAt: Date.now() - 3_000_000 }));
    const fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) }));
    vi.stubGlobal("fetch", fetch);
    f.service.markPlayable(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(f.disconnect).not.toHaveBeenCalled();
    expect(f.assign).not.toHaveBeenCalled();
    expect(f.service.api.accountState()).toMatchObject({ signedIn: true, gameSessionApproved: true });
  });

  it("leaves a background tab where it is, and lets it use the sign-in another tab restored once shown", async () => {
    const page = { hidden: true };
    vi.stubGlobal("document", page);
    const old = expiredToken();
    const f = setup({ accountToken: old, knownAccount: true });
    f.service.markPlayable(true);
    await expect(f.service.connectionToken(old)).rejects.toMatchObject({ reason: "no-grant" });
    expect(f.assign).not.toHaveBeenCalled();
    expect(f.service.canConnect()).toBe(false);
    const restored = accountToken();
    f.local.setItem(keys.accountTokenKey, restored);
    page.hidden = false;
    expect(f.service.canConnect()).toBe(true);
    expect(await f.service.connectionToken(old)).toBe(restored);
    expect(f.assign).not.toHaveBeenCalled();
  });

  it("sends the tab the player is looking at to sign in again", async () => {
    vi.stubGlobal("document", { hidden: false });
    const old = expiredToken();
    const f = setup({ accountToken: old, knownAccount: true });
    f.service.markPlayable(true);
    await expect(f.service.connectionToken(old)).rejects.toMatchObject({ reason: "no-grant" });
    expect(f.assign).toHaveBeenCalledOnce();
  });
});

describe("sign-out", () => {
  it("clears account credentials and a pending move, keeps the guest save, and ends the provider session", async () => {
    const token = accountToken();
    const { service, local, session, disconnect, assign } = setup({ accountToken: token, knownAccount: true, signedIn: true, guestToken: "guest-save" });
    local.setItem(refreshKey, "refresh-secret");
    session.setItem(keys.accountLinkKey, "pending-link");
    session.setItem(keys.loginMoveKey, "move-code");
    session.setItem(`${keys.loginMoveKey}/sign_in_next`, "true");
    service.markPlayable(true);
    expect(service.prepareUpdateReload("test-version")).toBe(true);
    await service.api.signOut();
    await service.api.signOut();
    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(local.getItem(refreshKey)).toBeNull();
    expect(local.getItem(keys.knownAccountKey)).toBeNull();
    expect(local.getItem(keys.guestTokenKey)).toBe("guest-save");
    for (const key of [keys.accountLinkKey, keys.loginMoveKey, `${keys.loginMoveKey}/sign_in_next`, "update-resume"]) expect(session.getItem(key)).toBeNull();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(service.canConnect()).toBe(false);
    await expect(service.connectionToken(token)).rejects.toThrow();
    expect(service.api.accountState()).toMatchObject({ signedIn: false, gameSessionApproved: false });
    expect(assign).toHaveBeenCalledOnce();
    const url = new URL(assign.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(`${SPACETIME_AUTH_ISSUER}/session/end`);
    expect(url.href).not.toContain("refresh-secret");
  });

  it("cannot restore a token from a callback that completes after sign-out", async () => {
    const request = new FakeTokenRequest(200, { id_token: accountToken() }, false);
    stubTokenRequest(request);
    const { service, local, connect } = setup({ authCallback: true });
    const restoring = service.restoreKnownAccount();
    await service.api.signOut();
    await vi.waitFor(() => expect(request.send).toHaveBeenCalled());
    request.onload?.({} as ProgressEvent);
    await restoring;
    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    expect(service.canConnect()).toBe(false);
  });

  it("Use Another Account clears the account and forces a fresh login on return", async () => {
    const signInNextKey = `${keys.loginMoveKey}/sign_in_next`;
    const f = setup({ signedIn: true, accountToken: accountToken(), knownAccount: true, guestToken: "guest-save" });
    f.session.setItem(keys.loginMoveKey, "stale-move");
    expect(await f.service.api.switchAccount()).toMatchObject({ ok: true });
    expect(new URL(f.assign.mock.calls[0][0]).pathname).toMatch(/\/session\/end$/);
    expect(f.local.getItem(keys.accountTokenKey)).toBeNull();
    expect(f.local.getItem(keys.guestTokenKey)).toBe("guest-save");
    expect(f.session.getItem(keys.loginMoveKey)).toBeNull();
    // Back from the provider's sign-out in the same tab.
    const back = setup();
    back.session.setItem(signInNextKey, f.session.getItem(signInNextKey)!);
    expect(back.service.canConnect()).toBe(false);
    await back.service.restoreKnownAccount();
    const signIn = new URL(back.assign.mock.calls[0][0]);
    expect(signIn.searchParams.get("prompt")).toBe("login");
    expect(signIn.searchParams.get("max_age")).toBe("0");
    expect(back.connect).not.toHaveBeenCalled();
  });
});

describe("session takeover", () => {
  it("restarts the connection and takes over once on the fresh one", async () => {
    const f = setup({ signedIn: true, accountToken: accountToken(), knownAccount: true });
    f.setWorldEntryBlocked(true);
    await f.service.api.takeOverSession();
    await f.service.api.takeOverSession();
    expect(f.restartConnectionForIdentityChange).toHaveBeenCalledOnce();
    const fresh = { isActive: true, disconnect: vi.fn(), reducers: { enterWorldWithTutorial: vi.fn(async () => {}) } };
    f.setConnection(fresh);
    expect(await f.service.handlePendingTakeover(fresh as never, () => true)).toBe(true);
    expect(fresh.reducers.enterWorldWithTutorial).toHaveBeenCalledWith({ tabId: f.service.tabId(), forceTakeover: true });
    await f.service.handlePendingTakeover(fresh as never, () => true);
    expect(fresh.reducers.enterWorldWithTutorial).toHaveBeenCalledOnce();
  });
});

describe("kill-report session enforcement", () => {
  it("clears account credentials and forces an interactive login without erasing the guest save", async () => {
    const f = setup({ accountToken: accountToken(), knownAccount: true, signedIn: true, guestToken: "saved-guest" });
    expect(f.service.handleDefeatRestriction("DEFEAT_SESSION_REAUTH")).toBe(true);
    expect(f.local.getItem(keys.accountTokenKey)).toBeNull();
    expect(f.local.getItem(keys.guestTokenKey)).toBe("saved-guest");
    expect(f.service.canConnect()).toBe(false);
    expect(f.disconnect).toHaveBeenCalledOnce();
    f.setConnection(null);
    await f.service.api.signIn();
    const url = new URL(f.assign.mock.calls[0][0]);
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("max_age")).toBe("0");
  });

  it("holds a guest for the cooldown, keeping their token and pending progress", () => {
    vi.useFakeTimers();
    const f = setup({ guestToken: "same-guest" });
    expect(f.service.handleDefeatRestriction(`DEFEAT_SESSION_COOLDOWN:${Date.now() + 30_000}`)).toBe(true);
    expect(f.service.canConnect()).toBe(false);
    expect(f.clearPendingProgress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(29_999); expect(f.service.canConnect()).toBe(false);
    vi.advanceTimersByTime(1); expect(f.service.canConnect()).toBe(true);
    expect(f.local.getItem(keys.guestTokenKey)).toBe("same-guest");
  });

  it("holds a seven-day suspension for the whole week", () => {
    vi.useFakeTimers();
    const f = setup({ guestToken: "same-guest" });
    const week = 7 * 86_400_000;
    f.service.handleDefeatRestriction(`DEFEAT_SESSION_COOLDOWN:${Date.now() + week}`);
    vi.advanceTimersByTime(30_000);
    expect(f.service.canConnect()).toBe(false);
    vi.advanceTimersByTime(week - 30_000);
    expect(f.service.canConnect()).toBe(true);
  });

  it("keeps a persisted cooldown on reload without treating it as an invalid guest token", () => {
    vi.useFakeTimers();
    const f = setup({ guestToken: "same-guest" });
    f.local.setItem(`${keys.guestTokenKey}:defeat-block-until`, String(Date.now() + 12_000));
    expect(f.service.canConnect()).toBe(false);
    expect(f.service.onConnectError(false, new Error(`DEFEAT_SESSION_COOLDOWN:${Date.now() + 12_000}`))).toBe(true);
    vi.advanceTimersByTime(12_000);
    expect(f.service.canConnect()).toBe(true);
    expect(f.local.getItem(keys.guestTokenKey)).toBe("same-guest");
  });
});

describe("moving a character to a Google sign-in", () => {
  it("leaves a code, signs out of the provider, then opens a forced sign-in on return", async () => {
    const f = setup({ signedIn: true, accountToken: accountToken(), knownAccount: true });
    const startLoginMove = vi.fn(async () => {});
    f.setConnection({ isActive: true, disconnect: vi.fn(), reducers: { startLoginMove } } as never);
    expect(await f.service.api.moveToGoogleSignIn()).toEqual({ ok: true });
    const code = f.session.getItem(keys.loginMoveKey)!;
    expect(startLoginMove).toHaveBeenCalledWith({ code });
    expect(new URL(f.assign.mock.calls[0][0]).pathname).toMatch(/\/session\/end$/);
    expect(f.local.getItem(keys.accountTokenKey)).toBeNull();
    // Back from signing out in the same tab: the code survived and the sign-in page opens.
    const back = setup();
    for (const key of [keys.loginMoveKey, `${keys.loginMoveKey}/sign_in_next`]) back.session.setItem(key, f.session.getItem(key)!);
    await back.service.restoreKnownAccount();
    expect(new URL(back.assign.mock.calls[0][0]).searchParams.get("prompt")).toBe("login");
    expect(back.session.getItem(keys.loginMoveKey)).toBe(code);
    expect(back.connect).not.toHaveBeenCalled();
  });

  it("claims once on return", async () => {
    const f = setup({ signedIn: true });
    f.session.setItem(keys.loginMoveKey, "move-code");
    const finishLoginMove = vi.fn(async () => {});
    const connection = { disconnect: vi.fn(), reducers: { finishLoginMove } };
    expect(await f.service.claimLoginMove(connection as never, true, () => true)).toBe(true);
    expect(finishLoginMove).toHaveBeenCalledWith({ code: "move-code" });
    expect(f.session.getItem(keys.loginMoveKey)).toBeNull();
    expect(await f.service.claimLoginMove(connection as never, true, () => true)).toBe(true);
    expect(finishLoginMove).toHaveBeenCalledOnce();
  });

  it("keeps the code when the old login is still open, so a reload retries", async () => {
    const f = setup({ signedIn: true });
    f.session.setItem(keys.loginMoveKey, "move-code");
    const connection = { disconnect: vi.fn(), reducers: {
      finishLoginMove: vi.fn().mockRejectedValue("Your old login is still open on another device or tab. Close WildStat there, then reload.") } };
    expect(await f.service.claimLoginMove(connection as never, true, () => true)).toBe(false);
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(f.session.getItem(keys.loginMoveKey)).toBe("move-code");
  });
});
