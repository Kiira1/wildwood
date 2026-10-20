import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountService } from "./account-service";
import { recordCarriedConnectionDiagnostic, recordConnectionDiagnostic } from "./connection-diagnostic-runtime";
vi.mock("./connection-diagnostic-runtime", () => ({ recordConnectionDiagnostic: vi.fn(), recordCarriedConnectionDiagnostic: vi.fn() }));
import { createUpdateResumeStore } from "./update-resume-store";
import { inspectSpacetimeIdToken, OidcIdTokenError } from "../security/oidc-id-token";
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

function setup(options: {
  accountToken?: string;
  guestToken?: string;
  knownAccount?: boolean;
  signedIn?: boolean;
  protocolBlocked?: boolean;
  authCallback?: boolean;
  updateResumeMode?: "account" | "guest" | null;
  validateAccountIdToken?: (token: string, expectedNonce: string) => Promise<ReturnType<typeof inspectSpacetimeIdToken>>;
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
  const replaceState = vi.fn();
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
  vi.stubGlobal("history", { replaceState });
  const connect = vi.fn();
  const notify = vi.fn();
  const restartConnectionForIdentityChange = vi.fn();
  const requestWorldEntry = vi.fn(async () => true);
  const disconnect = vi.fn();
  let connection = options.signedIn ? { isActive: true, reducers: { enterWorldWithTutorial: vi.fn(async () => {}) }, disconnect } : null;
  let worldEntryBlocked = false;
  const setWorldEntryBlocked = vi.fn((blocked: boolean) => { worldEntryBlocked = blocked; });
  const handleFailure = vi.fn();
  const drainPendingProgress = vi.fn(async () => true);
  const clearPendingProgress = vi.fn();
  const service = createAccountService({
    keys,
    updateResumeMode: options.updateResumeMode ?? null,
    updateResumeStore: createUpdateResumeStore(session, "update-resume"),
    notify,
    connection: () => connection as never,
    connectedSignedIn: () => Boolean(options.signedIn),
    hydrationReady: () => false,
    protocolBlocked: () => options.protocolBlocked ?? false,
    protocolReady: () => true,
    updating: () => false,
    worldEntryBlocked: () => worldEntryBlocked,
    setWorldEntryBlocked,
    requestWorldEntry,
    connect,
    restartConnectionForIdentityChange,
    scheduleReconnect: () => {},
    runWorldReducer: async (reducer) => reducer(),
    handleFailure,
    errorMessage: (error) => String(error),
    localIdentity: () => "guest-identity",
    localProfileReady: () => false,
    localDisplayName: () => "",
    localGender: () => 0,
    localProgress: () => null,
    drainPendingProgress,
    clearPendingProgress,
    disconnectVirtualPlayers: vi.fn(),
    validateAccountIdToken: options.validateAccountIdToken ?? (async (token, expectedNonce) => (
      inspectSpacetimeIdToken(token, { expectedNonce })
    )),
    ...(options.dpop ? { dpop: () => options.dpop! } : {}),
  });
  return { assign, connect, disconnect, local, session, notify, replaceState, requestWorldEntry, restartConnectionForIdentityChange, service,
    connection, setConnection: (value: typeof connection) => { connection = value; }, setWorldEntryBlocked, handleFailure,
    drainPendingProgress, clearPendingProgress };
}

describe("guest registration from both entry points", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it.each(["settings", "sign-in page"])("prepares and claims the same guest save from %s", async entry => {
    const f = setup({ guestToken: "existing-guest" });
    if (entry === "settings") f.service.api.continueAsGuest();
    else { await f.service.restoreKnownAccount(); expect(f.connect).toHaveBeenCalledOnce(); }
    const beginAccountLink = vi.fn(async () => {}), claimGuestAccount = vi.fn(async () => {});
    const connection = { isActive: true, disconnect: vi.fn(), reducers: { beginAccountLink, claimGuestAccount } };
    f.setConnection(connection as never);
    expect(await f.service.api.signIn()).toMatchObject({ ok: true, redirecting: true });
    expect(f.requestWorldEntry).toHaveBeenCalledOnce();
    expect(f.drainPendingProgress).toHaveBeenCalledOnce();
    expect(f.drainPendingProgress.mock.invocationCallOrder[0]).toBeLessThan(beginAccountLink.mock.invocationCallOrder[0]);
    expect(beginAccountLink.mock.invocationCallOrder[0]).toBeLessThan(f.assign.mock.invocationCallOrder[0]);
    const link = JSON.parse(f.session.getItem(keys.accountLinkKey)!);
    expect(link.guestIdentity).toBe("guest-identity");
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
    expect(f.clearPendingProgress).toHaveBeenCalledWith("guest-identity");
    expect(f.local.getItem(keys.guestTokenKey)).toBeNull();
    expect(f.session.getItem(keys.accountLinkKey)).toBeNull();
    await f.service.claimAccountLink(connection as never, true, () => true);
    expect(claimGuestAccount).toHaveBeenCalledOnce();
  });
  it("does not navigate away when saving the guest fails", async () => {
    const f = setup({ guestToken: "existing-guest" }), beginAccountLink = vi.fn();
    f.setConnection({ isActive: true, reducers: { beginAccountLink } } as never);
    f.drainPendingProgress.mockResolvedValue(false);
    expect(await f.service.api.signIn()).toMatchObject({ ok: false, error: "GUEST SAVE FAILED" });
    expect(f.assign).not.toHaveBeenCalled(); expect(beginAccountLink).not.toHaveBeenCalled();
    expect(f.local.getItem(keys.guestTokenKey)).toBe("existing-guest");
  });
  it.each(["Account link expired. Sign in again.", "This account already has Wildwood progress."])(
    "retains the guest save after a rejected claim: %s", async error => {
      const f = setup({ guestToken: "existing-guest", accountToken: accountToken() });
      f.session.setItem(keys.accountLinkKey, JSON.stringify({ code: "pending-link", guestIdentity: "guest-identity" }));
      const connection = { disconnect: vi.fn(), reducers: { claimGuestAccount: vi.fn().mockRejectedValue(error) } };
      await f.service.claimAccountLink(connection as never, true, () => true);
      expect(f.local.getItem(keys.guestTokenKey)).toBe("existing-guest");
      expect(f.clearPendingProgress).not.toHaveBeenCalled();
    });
});

it("approves a cryptographically verified callback even when the UI return marker is missing", async () => {
  const token = accountToken();
  stubTokenRequest(new FakeTokenRequest(200, { id_token: token }));
  // Simulate a callback reaching a service initialized before the native bridge
  // restored tab state: it did not start with session approval.
  const fresh = setup();
  fresh.session.setItem(keys.authStateKey, "expected-state");
  fresh.session.setItem(keys.authVerifierKey, "expected-verifier");
  fresh.session.setItem(keys.authNonceKey, "expected-nonce");
  window.location.href = "https://wildstat.example/game?code=one&state=expected-state";
  await fresh.service.restoreKnownAccount();
  expect(fresh.service.isSessionApproved()).toBe(true);
  expect(fresh.connect).toHaveBeenCalledOnce();
});

describe("explicit session takeover", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  function freshConnection() {
    return { isActive: true, disconnect: vi.fn(), reducers: { enterWorldWithTutorial: vi.fn(async () => {}) } };
  }
  it("restarts even a nominally active socket and takes over once on the fresh connection", async () => {
    const f = setup({ signedIn: true, accountToken: accountToken(), knownAccount: true });
    f.setWorldEntryBlocked(true);
    await f.service.api.takeOverSession(); await f.service.api.takeOverSession();
    expect(f.connection!.reducers.enterWorldWithTutorial).not.toHaveBeenCalled();
    expect(f.restartConnectionForIdentityChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.service.canConnect()).toBe(true);
    const fresh = freshConnection(); f.setConnection(fresh);
    expect(await f.service.handlePendingTakeover(fresh as never, () => true)).toBe(true);
    expect(fresh.reducers.enterWorldWithTutorial).toHaveBeenCalledExactlyOnceWith({ tabId: f.service.tabId(), forceTakeover: true });
    expect(fresh.disconnect).not.toHaveBeenCalled();
    expect(f.service.api.accountState().sessionConflict).toBe(false);
    await f.service.handlePendingTakeover(fresh as never, () => true);
    expect(fresh.reducers.enterWorldWithTutorial).toHaveBeenCalledTimes(1);
  });
  it("also reconnects disconnected accounts and guests without falling back to account choice", async () => {
    for (const options of [{ accountToken: accountToken(), knownAccount: true }, { guestToken: "guest" }]) {
      const f = setup(options);
      await f.service.api.takeOverSession();
      expect(f.restartConnectionForIdentityChange).toHaveBeenCalledWith(true);
      expect(f.service.canConnect()).toBe(true);
      expect(f.service.api.accountState().gameSessionApproved).toBe(true);
    }
  });
  it("ignores a late failure from an abandoned connection and retains the request for its replacement", async () => {
    const f = setup({ guestToken: "guest" }); await f.service.api.takeOverSession();
    const stale = freshConnection(); let reject!: (error: Error) => void;
    stale.reducers.enterWorldWithTutorial.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    let current = true;
    const pending = f.service.handlePendingTakeover(stale as never, () => current);
    current = false; reject(new Error("Connection closed"));
    expect(await pending).toBe(false);
    expect(f.handleFailure).not.toHaveBeenCalled();
    const fresh = freshConnection();
    expect(await f.service.handlePendingTakeover(fresh as never, () => true)).toBe(true);
    expect(fresh.reducers.enterWorldWithTutorial).toHaveBeenCalledTimes(1);
  });
  it("retries a closed transport without turning it into another session conflict", async () => {
    const f = setup({ guestToken: "guest" }); await f.service.api.takeOverSession();
    const closed = freshConnection(); closed.isActive = false;
    closed.reducers.enterWorldWithTutorial.mockRejectedValue(new Error("Connection closed"));
    expect(await f.service.handlePendingTakeover(closed as never, () => true)).toBe(false);
    expect(f.restartConnectionForIdentityChange).toHaveBeenCalledTimes(2);
    expect(f.service.api.accountState().sessionConflict).toBe(false);
    expect(await f.service.handlePendingTakeover(freshConnection() as never, () => true)).toBe(true);
  });
  it("makes a rejected takeover retryable", async () => {
    const f = setup({ guestToken: "guest" }); await f.service.api.takeOverSession();
    const conn = freshConnection(); conn.reducers.enterWorldWithTutorial.mockRejectedValueOnce(new Error("Rejected"));
    expect(await f.service.handlePendingTakeover(conn as never, () => true)).toBe(false);
    expect(f.service.api.accountState().sessionConflict).toBe(true);
    await f.service.api.takeOverSession();
    expect(await f.service.handlePendingTakeover(conn as never, () => true)).toBe(true);
  });
  it("cancels a pending takeover on sign-out and ignores its eventual response", async () => {
    const f = setup({ guestToken: "guest" }); await f.service.api.takeOverSession();
    const conn = freshConnection(); let finish!: () => void;
    conn.reducers.enterWorldWithTutorial.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.service.handlePendingTakeover(conn as never, () => true);
    await f.service.api.signOut(); finish();
    expect(await pending).toBe(false);
    expect(f.service.notice()).toBe("SIGNED OUT");
    const next = freshConnection(); await f.service.handlePendingTakeover(next as never, () => true);
    expect(next.reducers.enterWorldWithTutorial).not.toHaveBeenCalled();
    expect(await f.service.api.takeOverSession()).toEqual({ ok: false, error: "SIGNING OUT" });
  });
  it("does not restart when the game requires an update", async () => {
    const f = setup({ guestToken: "guest", protocolBlocked: true });
    expect(await f.service.api.takeOverSession()).toEqual({ ok: false, error: "UPDATE REQUIRED" });
    expect(f.restartConnectionForIdentityChange).not.toHaveBeenCalled();
  });
});

describe("account service startup identity selection", () => {
  it("keeps native preview sign-in from navigating or starting a guest link", async () => {
    const { service, assign, requestWorldEntry, session, local } = setup({ guestToken: "guest" });
    Object.assign(window, { WILDSTAT_NATIVE_PREVIEW: true });
    expect(await service.api.signIn()).toEqual({ ok: false, error: "APP SIGN-IN UNAVAILABLE · USE GUEST LOGIN" });
    expect(assign).not.toHaveBeenCalled();
    expect(requestWorldEntry).not.toHaveBeenCalled();
    expect(session.getItem(keys.authStateKey)).toBeNull();
    expect(local.getItem(keys.guestTokenKey)).toBe("guest");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns a fresh browser from Verifying Sign-In after a rejected OAuth callback", async () => {
    stubTokenRequest(new FakeTokenRequest(400, { error: "invalid_grant" }));
    const { notify, replaceState, service } = setup({ authCallback: true, knownAccount: true });

    await service.restoreKnownAccount();

    expect(service.api.accountState()).toMatchObject({
      authInProgress: false,
      returningFromSignIn: false,
      notice: "SIGN-IN FAILED · TRY AGAIN",
    });
    expect(notify).toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith({}, "", "/game");
  });

  it("times out a stalled OAuth token exchange instead of verifying forever", async () => {
    const request = new FakeTokenRequest(0, {}, false);
    stubTokenRequest(request);
    const { notify, service } = setup({ authCallback: true, knownAccount: true });

    const restore = service.restoreKnownAccount();
    // The request opens once the DPoP key is ready (none in this environment).
    await vi.waitFor(() => expect(request.send).toHaveBeenCalled());
    expect(request.timeout).toBe(15_000);
    request.ontimeout?.({} as ProgressEvent);
    await restore;

    expect(service.api.accountState()).toMatchObject({
      authInProgress: false,
      returningFromSignIn: false,
      notice: "SIGN-IN TIMED OUT · TRY AGAIN",
    });
    expect(notify).toHaveBeenCalled();
  });

  it("exchanges the callback with a form POST before connecting the account", async () => {
    const freshToken = accountToken();
    const request = new FakeTokenRequest(200, { id_token: freshToken });
    stubTokenRequest(request);
    const validateAccountIdToken = vi.fn(async (token: string, expectedNonce: string) => (
      inspectSpacetimeIdToken(token, { expectedNonce })
    ));
    const { connect, local, service } = setup({ authCallback: true, validateAccountIdToken });

    await service.restoreKnownAccount();

    expect(request.open).toHaveBeenCalledWith("POST", "https://auth.spacetimedb.com/oidc/token", true);
    expect(request.setRequestHeader).toHaveBeenCalledWith("content-type", "application/x-www-form-urlencoded");
    expect(request.send).toHaveBeenCalledWith(expect.stringContaining("code_verifier=expected-verifier"));
    expect(validateAccountIdToken).toHaveBeenCalledWith(freshToken, "expected-nonce");
    expect(local.getItem(keys.accountTokenKey)).toBe(freshToken);
    expect(service.api.accountState().notice).toBe("SIGNED IN");
    expect(connect).toHaveBeenCalledOnce();
  });

  it("rejects a callback ID token whose nonce does not match the initiating tab", async () => {
    const request = new FakeTokenRequest(200, { id_token: accountToken({ nonce: "attacker-nonce" }) });
    stubTokenRequest(request);
    const { connect, local, service } = setup({ authCallback: true });

    await service.restoreKnownAccount();

    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    expect(service.api.accountState()).toMatchObject({
      authInProgress: false,
      returningFromSignIn: false,
      notice: "SIGN-IN CHECK FAILED · TRY AGAIN",
    });
  });

  it("rejects a callback that identifies a different authorization issuer", async () => {
    const { connect, local, service } = setup({ authCallback: true });
    window.location.href = "https://wildstat.example/game?code=authorization-code&state=expected-state&iss=https%3A%2F%2Fattacker.example%2Foidc";

    await service.restoreKnownAccount();

    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    expect(service.api.accountState().notice).toBe("SIGN-IN CHECK FAILED");
  });

  it("shows a retryable security-check state when signing keys are unavailable", async () => {
    stubTokenRequest(new FakeTokenRequest(200, { id_token: accountToken() }));
    const { connect, local, service } = setup({
      authCallback: true,
      validateAccountIdToken: async () => { throw new OidcIdTokenError("keys"); },
    });

    await service.restoreKnownAccount();

    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    expect(service.api.accountState().notice).toBe("SIGN-IN CHECK UNAVAILABLE · TRY AGAIN");
  });

  it.each(["WildStat", "Wildstat", "Wildwood"])("keeps an existing signed-in save after a %s account-link rejection", async (name) => {
    const existingAccountToken = accountToken();
    const { local, session, service } = setup({
      accountToken: existingAccountToken,
      guestToken: "existing-guest-token",
      knownAccount: true,
      signedIn: true,
    });
    session.setItem(keys.accountLinkKey, JSON.stringify({ code: "private-link", guestIdentity: "guest-identity" }));
    session.setItem(keys.authTabKey, "test-tab");
    local.setItem(keys.accountMigrationPendingKey, JSON.stringify({ "test-tab": Date.now() }));
    const disconnect = vi.fn();
    const connection = {
      reducers: { claimGuestAccount: vi.fn().mockRejectedValue(new Error(`This account already has ${name} progress.`)) },
      disconnect,
    };

    await expect(service.claimAccountLink(connection as never, true, () => true)).resolves.toBe(true);
    expect(local.getItem(keys.accountTokenKey)).toBe(existingAccountToken);
    expect(session.getItem(keys.accountLinkKey)).toBeNull();
    expect(local.getItem(keys.accountMigrationPendingKey)).toBeNull();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("does not create a guest connection before a fresh visitor chooses", async () => {
    const { connect, service } = setup();

    await service.restoreKnownAccount();

    expect(connect).not.toHaveBeenCalled();
    expect(service.api.accountState().signInReady).toBe(true);
    expect(service.canConnect()).toBe(false);
  });

  it("starts a fresh visitor as a guest by default, but only once the restore has finished", async () => {
    const { service } = setup();
    expect(service.api.accountState()).toMatchObject({ restoring: true, guestByDefault: false });

    await service.restoreKnownAccount();

    expect(service.api.accountState()).toMatchObject({ restoring: false, guestByDefault: true });
  });

  it("does not start a guest by default for a known account, a stored token or a sign-in return", async () => {
    const known = setup({ knownAccount: true });
    await known.service.restoreKnownAccount();
    expect(known.service.api.accountState().guestByDefault).toBe(false);

    const token = setup({ accountToken: accountToken(), knownAccount: true });
    await token.service.restoreKnownAccount();
    expect(token.service.api.accountState().guestByDefault).toBe(false);

    const returning = setup({ authCallback: true });
    expect(returning.service.api.accountState().guestByDefault).toBe(false);
  });

  it("offers the choice on the page after Sign Out instead of starting a guest", async () => {
    const before = setup({ accountToken: accountToken(), knownAccount: true });
    await before.service.api.signOut();
    const marker = before.session.getItem(`${keys.loginMoveKey}/signed_out`);
    expect(marker).toBe("true");

    const after = setup();
    after.session.setItem(`${keys.loginMoveKey}/signed_out`, marker!);
    await after.service.restoreKnownAccount();
    expect(after.service.api.accountState().guestByDefault).toBe(false);
    // Only that page: a later visit starts as a guest again.
    expect(after.session.getItem(`${keys.loginMoveKey}/signed_out`)).toBeNull();
  });

  it("keeps overlapping native sign-ins on one PKCE transaction", async () => {
    const { service, session } = setup();
    const open = vi.fn(async () => {});
    Object.assign(window, { WILDSTAT_NATIVE_PREVIEW: true, wildstatNativeAuth: { ready: Promise.resolve(false), open, cancel: vi.fn() } });
    await Promise.all([service.api.signIn(), service.api.signIn()]);
    const state = session.getItem(keys.authStateKey);
    const verifier = session.getItem(keys.authVerifierKey);
    await service.api.signIn();
    expect(open).toHaveBeenCalledTimes(1);
    expect(session.getItem(keys.authStateKey)).toBe(state);
    expect(session.getItem(keys.authVerifierKey)).toBe(verifier);
  });

  it("allows another native sign-in after opening fails", async () => {
    const { service } = setup();
    const open = vi.fn().mockRejectedValueOnce(new Error("Unable to start sign-in")).mockResolvedValue(undefined);
    Object.assign(window, { WILDSTAT_NATIVE_PREVIEW: true, wildstatNativeAuth: { ready: Promise.resolve(false), open, cancel: vi.fn() } });
    await expect(service.api.signIn()).rejects.toThrow("Unable to start sign-in");
    await expect(service.api.signIn()).resolves.toMatchObject({ ok: true, redirecting: true });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("opens native OAuth with the hosted callback and preserves PKCE state", async () => {
    const { assign, service, session } = setup();
    const open = vi.fn(async () => {});
    Object.assign(window, { WILDSTAT_NATIVE_PREVIEW: true, wildstatNativeAuth: { ready: Promise.resolve(false), open, cancel: vi.fn() } });
    expect(await service.api.signIn()).toMatchObject({ ok: true, redirecting: true });
    expect(assign).not.toHaveBeenCalled();
    const [raw, savedKeys] = open.mock.calls[0] as unknown as [string, string[]];
    const url = new URL(raw);
    expect(url.searchParams.get("redirect_uri")).toBe("https://wildstatmmo.com/app-auth/");
    expect(url.searchParams.get("state")).toBe(session.getItem(keys.authStateKey));
    expect(savedKeys).toContain(keys.authVerifierKey);
    expect(savedKeys).toContain(keys.accountLinkKey);
    expect(savedKeys).not.toContain(keys.accountTokenKey);
  });

  it("starts OAuth directly for a fresh registration without loading a guest", async () => {
    const { assign, connect, service, session } = setup();

    const result = await service.api.signIn();

    expect(result).toMatchObject({ ok: true, redirecting: true });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
    const authorizationUrl = new URL(assign.mock.calls[0][0]);
    expect(authorizationUrl.searchParams.get("nonce")).toBe(session.getItem(keys.authNonceKey));
    expect(authorizationUrl.searchParams.get("prompt")).toBe("login");
    expect(session.getItem(keys.authNonceKey)).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("clears a malformed persisted account token before connection", async () => {
    const { connect, local, service } = setup({
      accountToken: "not-a-jwt",
      knownAccount: true,
    });

    await service.restoreKnownAccount();

    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    expect(service.api.accountState().notice).toBe("SIGN-IN REQUIRED");
  });

  it("cancels an outbound OAuth flow restored from the back-forward cache without a callback", async () => {
    const { notify, session, service } = setup();

    await service.api.signIn();
    expect(service.api.accountState().returningFromSignIn).toBe(true);
    expect(session.getItem(keys.authReturnUiKey)).toBe("true");

    expect(service.cancelAbandonedSignIn()).toBe(true);
    expect(service.api.accountState()).toMatchObject({
      authInProgress: false,
      returningFromSignIn: false,
      notice: "",
    });
    expect(service.isSessionApproved()).toBe(false);
    expect(session.getItem(keys.authReturnUiKey)).toBeNull();
    expect(session.getItem(keys.authStateKey)).toBeNull();
    expect(session.getItem(keys.authVerifierKey)).toBeNull();
    expect(session.getItem(keys.authNonceKey)).toBeNull();
    expect(notify).toHaveBeenCalled();
  });

  it("does not cancel a genuine OAuth callback", () => {
    const { session, service } = setup({ authCallback: true });

    expect(service.cancelAbandonedSignIn()).toBe(false);
    expect(service.api.accountState()).toMatchObject({
      authInProgress: true,
      returningFromSignIn: true,
    });
    expect(session.getItem(keys.authReturnUiKey)).toBe("true");
  });

  it("connects a returning guest in the auth layer so their save can be linked", async () => {
    const { connect, service } = setup({ guestToken: "guest-token-value" });

    await service.restoreKnownAccount();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(service.api.accountState().signInReady).toBe(false);
  });

  it("silently clears account auth but preserves the remembered account when Guest is chosen", () => {
    const { local, restartConnectionForIdentityChange, service } = setup({
      accountToken: accountToken(),
      guestToken: "guest-token-value",
      knownAccount: true,
    });

    const result = service.api.continueAsGuest();

    expect(result).toEqual({ ok: true });
    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(local.getItem(keys.knownAccountKey)).toBe("true");
    expect(service.api.accountState().guestSessionApproved).toBe(true);
    expect(restartConnectionForIdentityChange).toHaveBeenCalledTimes(1);
  });
});

describe("complete account sign-out", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("clears account credentials, cancels update resume, disconnects, and ends the provider session", async () => {
    const token = accountToken();
    const { service, local, session, disconnect, assign } = setup({ accountToken: token, knownAccount: true, signedIn: true, guestToken: "guest-save" });
    local.setItem(`${keys.accountTokenKey}:refresh`, "refresh-secret");
    local.setItem(keys.knownAccountCharacterKey, "Previous Character");
    session.setItem(keys.authReturnUiKey, "true");
    session.setItem(keys.authRetryKey, "true");
    session.setItem(keys.authNonceKey, "nonce");
    session.setItem(keys.accountLinkKey, "pending-link");
    service.markPlayable(true);
    expect(service.prepareUpdateReload("test-version")).toBe(true);

    await service.api.signOut();
    await service.api.signOut();

    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(local.getItem(`${keys.accountTokenKey}:refresh`)).toBeNull();
    expect(local.getItem(keys.knownAccountKey)).toBeNull();
    expect(local.getItem(keys.knownAccountCharacterKey)).toBeNull();
    expect(local.getItem(keys.guestTokenKey)).toBe("guest-save");
    for (const key of [keys.authReturnUiKey, keys.authRetryKey, keys.authNonceKey, keys.accountLinkKey, "update-resume"]) expect(session.getItem(key)).toBeNull();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(service.canConnect()).toBe(false);
    await expect(service.connectionToken(token)).rejects.toThrow("Signed out");
    expect(service.api.accountState()).toMatchObject({ signedIn: false, gameSessionApproved: false });
    expect(assign).toHaveBeenCalledOnce();
    const url = new URL(assign.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(`${SPACETIME_AUTH_ISSUER}/session/end`);
    expect(url.searchParams.get("id_token_hint")).toBe(token);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://wildstat.example/game");
    expect(url.searchParams.get("client_id")).toBe(SPACETIME_AUTH_CLIENT_ID);
    expect(url.href).not.toContain("refresh-secret");
  });

  it("does not wait for a stuck notification plugin before signing out on mobile", async () => {
    const { service, local, assign } = setup({ accountToken: accountToken(), knownAccount: true, signedIn: true });
    const signOut = vi.fn(async (_url: string) => {});
    Object.assign(window, {
      WILDSTAT_NATIVE_PREVIEW: true,
      wildstatResearchNotifications: { sync: () => new Promise(() => {}) },
      wildstatNativeAuth: { ready: Promise.resolve(false), open: vi.fn(), cancel: vi.fn(), signOut },
    });
    await service.api.signOut();
    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(window.location.reload).toHaveBeenCalledOnce();
    const url = new URL(signOut.mock.calls[0][0] as string);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://wildstatmmo.com/app-auth/");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("cannot restore a token from a callback that completes after sign-out", async () => {
    const request = new FakeTokenRequest(200, { id_token: accountToken() }, false);
    stubTokenRequest(request);
    const { service, local, connect } = setup({ authCallback: true });
    const restoring = service.restoreKnownAccount();
    await service.api.signOut();
    await vi.waitFor(() => expect(request.send).toHaveBeenCalled());   // opens once the DPoP key is ready
    request.onload?.({} as ProgressEvent);
    await restoring;
    expect(local.getItem(keys.accountTokenKey)).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    expect(service.canConnect()).toBe(false);
  });

  it("cannot finish preparing a new sign-in after the player signs out", async () => {
    const { service, assign, session } = setup();
    const starting = service.api.signIn();
    await service.api.signOut();
    await starting;
    expect(assign).toHaveBeenCalledOnce();
    expect(new URL(assign.mock.calls[0][0]).pathname).toBe("/oidc/session/end");
    expect(session.getItem(keys.authVerifierKey)).toBeNull();
    expect(session.getItem(keys.authStateKey)).toBeNull();
  });
});

it("keeps an admitted account approved while a portal reconnects without approving a signed-out session", () => {
  const { service } = setup({ accountToken: accountToken(), knownAccount: true });
  expect(service.api.accountState().gameSessionApproved).toBe(false);
  service.markPlayable(true);
  expect(service.api.accountState()).toMatchObject({ signedIn: false, gameSessionApproved: true });
});

it.each([true, false])("preserves the admitted session for a recovery reload (account=%s)", signedIn => {
  const { service, session } = setup({ accountToken: signedIn ? accountToken() : undefined, knownAccount: signedIn });
  expect(service.prepareUpdateReload("0.681")).toBe(false);
  service.markPlayable(signedIn);
  expect(service.prepareUpdateReload("0.681")).toBe(true);
  const store = createUpdateResumeStore(session, "update-resume");
  expect(store.consume("0.681")).toBe(signedIn ? "account" : "guest");
  expect(store.consume("0.681")).toBeNull();
});


describe("connection authentication failures", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["Failed to verify token: Bad Gateway", "Failed to verify token: HTTP 503 Service Unavailable", "Failed to fetch"])("keeps saved credentials for temporary failure: %s", message => {
    const token = accountToken();
    const { service, local } = setup({ accountToken: token, knownAccount: true });
    expect(service.onConnectError(true, new Error(message))).toBe(false);
    expect(local.getItem(keys.accountTokenKey)).toBe(token);
  });
  it("still requires sign-in for an explicit unauthorized response", () => {
    const { service, local } = setup({ accountToken: accountToken(), knownAccount: true });
    expect(service.onConnectError(true, new Error("Failed to verify token: HTTP 401 Unauthorized"))).toBe(true);
    expect(local.getItem(keys.accountTokenKey)).toBeNull();
  });
});

it("retains an admitted account and its expired credential during wake recovery", () => {
  const token = accountToken({ exp: Math.floor(Date.now() / 1000) - 10 });
  const { service, local } = setup({ accountToken: token, knownAccount: true });
  service.markPlayable(true);
  expect(service.accountToken()).toBeNull();
  expect(service.connectionCredential()).toBe(token);
  expect(service.canConnect()).toBe(true);
  expect(service.api.accountState().gameSessionApproved).toBe(true);
  expect(local.getItem(keys.accountTokenKey)).toBe(token);
});

it("does not reload gameplay when another tab renews the same account", () => {
  const old = accountToken({ exp: Math.floor(Date.now() / 1000) - 10 });
  const { service } = setup({ accountToken: accountToken(), knownAccount: true });
  service.handleStorageEvent({ key: keys.accountTokenKey, oldValue: old, newValue: accountToken() } as StorageEvent);
  expect(window.location.reload).not.toHaveBeenCalled();
  service.handleStorageEvent({ key: keys.accountTokenKey, oldValue: old, newValue: accountToken({ sub: "someone-else" }) } as StorageEvent);
  expect(window.location.reload).toHaveBeenCalledOnce();
});

it("stores a refresh grant after a verified callback and removes it on switching to guest", async () => {
  const { service, local } = setup({ authCallback: true });
  stubTokenRequest(new FakeTokenRequest(200, { id_token: accountToken(), refresh_token: "refresh-grant" }));
  await service.restoreKnownAccount();
  expect(JSON.parse(local.getItem(`${keys.accountTokenKey}:refresh`)!)).toMatchObject({ subject: "account-subject", token: "refresh-grant", nonce: "expected-nonce" });
  service.api.continueAsGuest();
  expect(local.getItem(`${keys.accountTokenKey}:refresh`)).toBeNull();
});

describe("sign-in round trips", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.mocked(recordCarriedConnectionDiagnostic).mockClear(); });
  it("reuses the provider session for a returning account instead of forcing a new login", async () => {
    const f = setup({ knownAccount: true });
    await f.service.api.signIn();
    const url = new URL(f.assign.mock.calls[0][0]);
    expect(url.searchParams.get("prompt")).toBeNull();
    // Any max_age puts auth_time in every token; a year never forces a login.
    expect(url.searchParams.get("max_age")).toBe(String(365 * 86_400));
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });
  it("reports why the player left and how long the trip took once they return", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const f = setup({ knownAccount: true });
    await f.service.api.signIn();
    const state = f.session.getItem(keys.authStateKey)!;
    vi.setSystemTime(1_042_000);
    f.session.setItem(keys.authNonceKey, "expected-nonce");
    stubTokenRequest(new FakeTokenRequest(200, { id_token: accountToken(), refresh_token: "grant" }));
    window.location.href = `https://wildstat.example/game?code=one&state=${state}`;
    await f.service.restoreKnownAccount();
    expect(recordCarriedConnectionDiagnostic).toHaveBeenCalledWith("session-blocked", { detail: "sign-in-return:success:known-account:silent:42s:dpop=unbound" });
    expect(f.session.getItem(keys.authTripKey)).toBeNull();
  });
  it("connects a forced login straight away, noting a missing refresh grant or offline_access scope", async () => {
    const f = setup();
    await f.service.api.signIn();
    const forced = new URL(f.assign.mock.calls[0][0]);
    expect(forced.searchParams.get("prompt")).toBe("login");
    f.session.setItem(keys.authNonceKey, "expected-nonce");
    stubTokenRequest(new FakeTokenRequest(200, { id_token: accountToken(), scope: "openid profile email" }));
    window.location.href = `https://wildstat.example/game?code=one&state=${forced.searchParams.get("state")}`;
    await f.service.restoreKnownAccount();
    expect(f.assign).toHaveBeenCalledOnce();
    expect(f.connect).toHaveBeenCalledOnce();
    expect(recordCarriedConnectionDiagnostic).toHaveBeenCalledWith("session-blocked", {
      detail: expect.stringMatching(/^sign-in-return:success:register:prompt:\d+s:no-grant:no-offline:dpop=unbound$/),
    });
  });
  it("plays on without a grant rather than repeating the follow-up", async () => {
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
  it("says why a return failed and names the account, since a guest may upload it", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const f = setup({ knownAccount: true });
    f.local.setItem(keys.knownAccountCharacterKey, "Pearl");
    await f.service.api.signIn();
    const state = f.session.getItem(keys.authStateKey)!;
    vi.setSystemTime(1_004_000);
    stubTokenRequest(new FakeTokenRequest(400, { error: "invalid_grant" }));
    window.location.href = `https://wildstat.example/game?code=one&state=${state}`;
    await f.service.restoreKnownAccount();
    expect(recordCarriedConnectionDiagnostic).toHaveBeenCalledWith("session-blocked", {
      detail: "sign-in-return:failed:known-account:silent:4s:why=failed:invalid_grant;acct=Pearl",
    });
  });
  it("still reports a failed return whose tab lost the trip record", async () => {
    const f = setup({ knownAccount: true });
    f.local.setItem(keys.knownAccountCharacterKey, "Pearl");
    window.location.href = "https://wildstat.example/game?code=one&state=from-another-tab";
    await f.service.restoreKnownAccount();
    expect(recordCarriedConnectionDiagnostic).toHaveBeenCalledWith("session-blocked", {
      detail: "sign-in-return:failed:unknown-trip:why=tab-lost-state;acct=Pearl",
    });
  });
  it("reports once when a sign-in that worked falls back to the sign-in screen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = setup({ authCallback: true, knownAccount: true });
    f.local.setItem(keys.knownAccountCharacterKey, "Pearl");
    stubTokenRequest(new FakeTokenRequest(200, { id_token: accountToken(), refresh_token: "grant" }));
    await f.service.restoreKnownAccount();
    expect(f.service.api.accountState().gameSessionApproved).toBe(true);
    const lost = () => vi.mocked(recordCarriedConnectionDiagnostic).mock.calls
      .filter(([, data]) => data?.detail?.startsWith("sign-in-lost:"));
    expect(lost()).toHaveLength(0);
    // The server refuses the new login a second time in this tab.
    f.session.setItem(keys.authRetryKey, "true");
    f.service.onConnectError(true, new Error("HTTP 401 Unauthorized"));
    f.service.api.accountState();
    f.service.api.accountState();
    expect(lost()).toHaveLength(1);
    expect(lost()[0][1]!.detail).toMatch(/^sign-in-lost:after=\d+s;notice=SIGN-IN REQUIRED;token=none;approved=no;acct=Pearl$/);
    expect(recordCarriedConnectionDiagnostic).toHaveBeenCalledWith("session-blocked", {
      detail: "authentication-rejected: HTTP 401 Unauthorized;acct=Pearl",
    });
    expect(warn).toHaveBeenCalledWith("WildStat sign-in lost:", lost()[0][1]!.detail);
    warn.mockRestore();
  });
  it("does not report a player who chose Guest or signed out", async () => {
    const f = setup({ authCallback: true, knownAccount: true });
    stubTokenRequest(new FakeTokenRequest(200, { id_token: accountToken(), refresh_token: "grant" }));
    await f.service.restoreKnownAccount();
    f.service.api.continueAsGuest();
    f.service.api.accountState();
    expect(vi.mocked(recordCarriedConnectionDiagnostic).mock.calls.some(([, data]) => data?.detail?.startsWith("sign-in-lost:"))).toBe(false);
  });
});

describe("kill-report session enforcement", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("clears account credentials and requires interactive authentication without erasing the guest save", async () => {
    const f = setup({ accountToken: accountToken(), knownAccount: true, signedIn: true, guestToken: "saved-guest" });
    expect(f.service.handleDefeatRestriction("DEFEAT_SESSION_REAUTH")).toBe(true);
    expect(f.local.getItem(keys.accountTokenKey)).toBeNull();
    expect(f.local.getItem(keys.guestTokenKey)).toBe("saved-guest");
    expect(f.service.canConnect()).toBe(false);
    expect(f.disconnect).toHaveBeenCalledOnce();
    f.setConnection(null as never);
    await f.service.api.signIn();
    const url = new URL(f.assign.mock.calls[0][0]);
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("max_age")).toBe("0");
  });
  it("holds a guest for 30 seconds, preserving their token and pending progress", () => {
    vi.useFakeTimers();
    const f = setup({ guestToken: "same-guest" });
    const until = Date.now() + 30_000;
    expect(f.service.handleDefeatRestriction(`DEFEAT_SESSION_COOLDOWN:${until}`)).toBe(true);
    expect(f.service.canConnect()).toBe(false);
    expect(f.local.getItem(keys.guestTokenKey)).toBe("same-guest");
    expect(f.clearPendingProgress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(29_999); expect(f.service.canConnect()).toBe(false);
    vi.advanceTimersByTime(1); expect(f.service.canConnect()).toBe(true);
    expect(f.setWorldEntryBlocked).toHaveBeenLastCalledWith(false);
    expect(f.local.getItem(keys.guestTokenKey)).toBe("same-guest");
  });
  it("respects a seven-day administrative suspension without retrying every 30 seconds", () => {
    vi.useFakeTimers();
    const f = setup({ guestToken: "same-guest" });
    const week = 7 * 86_400_000;
    f.service.handleDefeatRestriction(`DEFEAT_SESSION_COOLDOWN:${Date.now() + week}`);
    expect(f.service.api.accountState().notice).toContain("ACCOUNT SUSPENDED UNTIL");
    vi.advanceTimersByTime(30_000);
    expect(f.service.canConnect()).toBe(false);
    vi.advanceTimersByTime(week - 30_000);
    expect(f.service.canConnect()).toBe(true);
  });
  it("keeps a persisted cooldown on reload and does not classify it as an invalid guest token", () => {
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
  afterEach(() => { vi.unstubAllGlobals(); });
  it("saves, leaves a code, signs out of SpacetimeAuth, then opens a forced sign-in on return", async () => {
    const f = setup({ signedIn: true, accountToken: accountToken(), knownAccount: true });
    const startLoginMove = vi.fn(async () => {});
    f.setConnection({ isActive: true, disconnect: vi.fn(), reducers: { startLoginMove } } as never);
    expect(await f.service.api.moveToGoogleSignIn()).toEqual({ ok: true });
    const code = f.session.getItem(keys.loginMoveKey)!;
    expect(startLoginMove).toHaveBeenCalledWith({ code });
    expect(f.drainPendingProgress.mock.invocationCallOrder[0]).toBeLessThan(startLoginMove.mock.invocationCallOrder[0]);
    // A different user signing in over a live session loses the sign-in at SpacetimeAuth, so it ends first.
    expect(new URL(f.assign.mock.calls[0][0]).pathname).toMatch(/\/session\/end$/);
    expect(f.local.getItem(keys.accountTokenKey)).toBeNull();

    // Back from signing out, in the same tab: the move code survived, and the sign-in page opens.
    const back = setup();
    for (const key of [keys.loginMoveKey, `${keys.loginMoveKey}/sign_in_next`]) back.session.setItem(key, f.session.getItem(key)!);
    await back.service.restoreKnownAccount();
    const signIn = new URL(back.assign.mock.calls[0][0]);
    expect(signIn.searchParams.get("prompt")).toBe("login");
    expect(back.session.getItem(keys.loginMoveKey)).toBe(code);
    expect(back.session.getItem(`${keys.loginMoveKey}/sign_in_next`)).toBeNull();
    expect(back.connect).not.toHaveBeenCalled();
  });
  it("forgets a pending move on an ordinary sign-out", async () => {
    const f = setup({ signedIn: true, accountToken: accountToken(), knownAccount: true });
    f.session.setItem(keys.loginMoveKey, "move-code");
    f.session.setItem(`${keys.loginMoveKey}/sign_in_next`, "true");
    f.setConnection({ isActive: true, disconnect: vi.fn(), reducers: {} } as never);
    await f.service.api.signOut();
    expect(f.session.getItem(keys.loginMoveKey)).toBeNull();
    expect(f.session.getItem(`${keys.loginMoveKey}/sign_in_next`)).toBeNull();
  });
  it("stays put when the server refuses to start", async () => {
    const f = setup({ signedIn: true, accountToken: accountToken(), knownAccount: true });
    f.setConnection({ isActive: true, reducers: { startLoginMove: vi.fn().mockRejectedValue("Sign in to your character first.") } } as never);
    expect(await f.service.api.moveToGoogleSignIn()).toMatchObject({ ok: false, error: "Sign in to your character first." });
    expect(f.assign).not.toHaveBeenCalled();
    expect(f.session.getItem(keys.loginMoveKey)).toBeNull();
  });
  it("claims once on return, then enters the world", async () => {
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
  it("keeps the code and stops when the old login is still open, so a reload retries", async () => {
    const f = setup({ signedIn: true });
    f.session.setItem(keys.loginMoveKey, "move-code");
    const connection = { disconnect: vi.fn(), reducers: {
      finishLoginMove: vi.fn().mockRejectedValue("Your old login is still open on another device or tab. Close WildStat there, then reload.") } };
    expect(await f.service.claimLoginMove(connection as never, true, () => true)).toBe(false);
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(f.session.getItem(keys.loginMoveKey)).toBe("move-code");
    expect(f.service.api.accountState().notice).toMatch(/STILL OPEN/);
  });
  it("drops the code and plays on after any other refusal", async () => {
    const f = setup({ signedIn: true });
    f.session.setItem(keys.loginMoveKey, "move-code");
    const connection = { disconnect: vi.fn(), reducers: {
      finishLoginMove: vi.fn().mockRejectedValue("This login already has a character (Fern). Use a Google account that has not played WildStat.") } };
    expect(await f.service.claimLoginMove(connection as never, true, () => true)).toBe(true);
    expect(connection.disconnect).not.toHaveBeenCalled();
    expect(f.session.getItem(keys.loginMoveKey)).toBeNull();
    expect(f.service.api.accountState().notice).toBe("NOT MOVED · THAT GOOGLE ACCOUNT ALREADY HAS A CHARACTER");
  });
});

describe("the remembered guest character", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("is only offered while its guest token is still on this browser", () => {
    const orphaned = setup();
    orphaned.local.setItem(keys.knownGuestCharacterKey, "Pearl");
    expect(orphaned.service.api.knownCharacter()).toBe("");
    expect(orphaned.service.rememberedCharacter(false)).toBe("");
    const guest = setup({ guestToken: "guest-save" });
    guest.local.setItem(keys.knownGuestCharacterKey, "Pearl");
    expect(guest.service.api.knownCharacter()).toBe("Pearl");
  });
  it("is forgotten once the guest save is linked to an account", async () => {
    const f = setup({ signedIn: true, guestToken: "guest-save" });
    f.local.setItem(keys.knownGuestCharacterKey, "Pearl");
    f.session.setItem(keys.accountLinkKey, JSON.stringify({ code: "c".repeat(40), guestIdentity: "guest-identity" }));
    const connection = { disconnect: vi.fn(), reducers: { claimGuestAccount: vi.fn(async () => {}) } };
    expect(await f.service.claimAccountLink(connection as never, true, () => true)).toBe(true);
    expect(f.local.getItem(keys.knownGuestCharacterKey)).toBeNull();
  });
  it("is forgotten on sign-out, and nothing is remembered while signing out", async () => {
    const f = setup({ signedIn: true, accountToken: accountToken(), knownAccount: true, guestToken: "guest-save" });
    f.local.setItem(keys.knownGuestCharacterKey, "Pearl");
    await f.service.api.signOut();
    expect(f.local.getItem(keys.knownGuestCharacterKey)).toBeNull();
    f.service.rememberConfirmedCharacter("Gehn");
    f.service.rememberConfirmedGender(1);
    expect(f.local.getItem(keys.knownAccountCharacterKey)).toBeNull();
    expect(f.local.getItem(keys.knownGuestCharacterKey)).toBeNull();
    expect(f.local.getItem(keys.knownAccountGenderKey)).toBeNull();
  });
});

describe("using another account", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(recordCarriedConnectionDiagnostic).mockClear(); });
  const signInNextKey = `${keys.loginMoveKey}/sign_in_next`;
  it.each([
    ["a stored account", { signedIn: true, accountToken: accountToken(), knownAccount: true }],
    ["a known account with no token", { knownAccount: true }],
  ])("from %s: ends the provider session, then forces a login that asks which account", async (_label, options) => {
    const f = setup(options);
    f.local.setItem(keys.knownAccountCharacterKey, "Gehn");
    f.session.setItem(keys.loginMoveKey, "stale-move");
    expect(await f.service.api.switchAccount()).toEqual({ ok: true, redirecting: true });
    expect(new URL(f.assign.mock.calls[0][0]).pathname).toMatch(/\/session\/end$/);
    for (const key of [keys.accountTokenKey, keys.knownAccountKey, keys.knownAccountCharacterKey]) expect(f.local.getItem(key)).toBeNull();
    expect(f.session.getItem(keys.loginMoveKey)).toBeNull();
    expect(f.session.getItem(signInNextKey)).toBe("switch-account");
    expect(f.service.api.accountState()).toMatchObject({ hasAccountToken: false, knownAccount: false });

    // Back from SpacetimeAuth's sign-out in the same tab.
    const back = setup();
    back.session.setItem(signInNextKey, f.session.getItem(signInNextKey)!);
    expect(back.service.canConnect()).toBe(false);
    await back.service.restoreKnownAccount();
    expect(back.assign).toHaveBeenCalledOnce();
    const signIn = new URL(back.assign.mock.calls[0][0]);
    expect(signIn.pathname).toMatch(/\/auth$/);
    expect(signIn.searchParams.get("prompt")).toBe("login");
    expect(signIn.searchParams.get("max_age")).toBe("0");
    expect(JSON.parse(back.session.getItem(keys.authTripKey)!)).toMatchObject({ reason: "switch-account", prompt: true });
    expect(back.session.getItem(signInNextKey)).toBeNull();
    expect(back.connect).not.toHaveBeenCalled();
  });
  it("still opens a character move's sign-in left by an older page", async () => {
    const back = setup();
    back.session.setItem(keys.loginMoveKey, "move-code");
    back.session.setItem(signInNextKey, "true");
    await back.service.restoreKnownAccount();
    expect(new URL(back.assign.mock.calls[0][0]).searchParams.get("prompt")).toBe("login");
    expect(JSON.parse(back.session.getItem(keys.authTripKey)!)).toMatchObject({ reason: "login-move" });
  });

  async function returnAs(options: { trip?: Record<string, unknown>; tapped?: string; sub?: string }) {
    const f = setup({ knownAccount: true, signedIn: true });
    f.local.setItem(keys.knownAccountCharacterKey, options.tapped ?? "Pearl");
    f.setConnection(null);
    if (options.trip) {
      f.session.setItem(keys.authTripKey, JSON.stringify({ at: Date.now(), ...options.trip }));
      f.session.setItem(keys.authStateKey, "expected-state");
      f.session.setItem(keys.authVerifierKey, "expected-verifier");
    } else {
      await f.service.api.signIn();
      expect(JSON.parse(f.session.getItem(keys.authTripKey)!)).toMatchObject({ reason: "known-account", character: "Pearl", sub: "" });
    }
    f.session.setItem(keys.authNonceKey, "expected-nonce");
    stubTokenRequest(new FakeTokenRequest(200, { id_token: accountToken(options.sub ? { sub: options.sub } : {}), refresh_token: "grant" }));
    window.location.href = `https://wildstat.example/game?code=one&state=${f.session.getItem(keys.authStateKey)}`;
    await f.service.restoreKnownAccount();
    f.setConnection({ isActive: true, disconnect: vi.fn(), reducers: {} } as never);
    return f;
  }
  it("says so when SIGN IN loads a different character from the one tapped, without blocking play", async () => {
    const f = await returnAs({});
    expect(f.connect).toHaveBeenCalledOnce();
    f.service.rememberConfirmedCharacter("Gehn");
    expect(f.service.api.accountState()).toMatchObject({ signedInAs: "Gehn", notice: "Signed In As Gehn · Not You? Use Another Account" });
    expect(f.local.getItem(keys.knownAccountCharacterKey)).toBe("Gehn");
    expect(recordCarriedConnectionDiagnostic).toHaveBeenCalledWith("session-blocked", { detail: "sign-in-changed-account:expected=Pearl;got=Gehn" });
    // Checked once per trip: later profile rows change nothing.
    f.service.rememberConfirmedCharacter("Pearl");
    expect(f.service.api.accountState().signedInAs).toBe("Gehn");
  });
  it("stays quiet when the tapped character loads", async () => {
    const f = await returnAs({});
    f.service.rememberConfirmedCharacter("Pearl");
    expect(f.service.api.accountState().signedInAs).toBe("");
  });
  it("names a new, empty character too", async () => {
    const f = await returnAs({});
    f.service.rememberConfirmedCharacter("Mossy Fox 123");
    expect(f.service.api.accountState().signedInAs).toBe("A New Character");
  });
  it("trusts the same login over a renamed character, and a different login over the same name", async () => {
    const same = await returnAs({ trip: { reason: "token-rejected", prompt: false, character: "Pearl", sub: "account-subject" } });
    same.service.rememberConfirmedCharacter("Pearl Renamed");
    expect(same.service.api.accountState().signedInAs).toBe("");
    const other = await returnAs({ trip: { reason: "token-rejected", prompt: false, character: "Pearl", sub: "account-subject" }, sub: "someone-else" });
    other.service.rememberConfirmedCharacter("Pearl");
    expect(other.service.api.accountState().signedInAs).toBe("Pearl");
  });
  it("is cleared by Use Another Account itself", async () => {
    const f = await returnAs({});
    f.service.rememberConfirmedCharacter("Gehn");
    await f.service.api.switchAccount();
    expect(f.service.api.accountState().signedInAs).toBe("");
  });
});

describe("DPoP at the code exchange", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(recordCarriedConnectionDiagnostic).mockClear(); });
  function stubTokenRequests(...requests: FakeTokenRequest[]) {
    const queue = [...requests];
    vi.stubGlobal("XMLHttpRequest", vi.fn(function XMLHttpRequestMock() { return queue.shift(); }));
  }
  const dpopHeader = (request: FakeTokenRequest) => request.setRequestHeader.mock.calls.find(([name]) => name === "DPoP")?.[1];
  it("binds the refresh token to this device when the switch is on, and says so on return", async () => {
    const dpop = createDpop({ indexedDB: fakeIndexedDB().indexedDB, subtle: crypto.subtle });
    const request = new FakeTokenRequest(200, { id_token: accountToken(), refresh_token: "bound-grant", token_type: "DPoP" });
    stubTokenRequests(request);
    const f = setup({ knownAccount: true, dpop });
    f.local.setItem(DPOP_SWITCH_KEY, "on");
    await f.service.api.signIn();
    const state = f.session.getItem(keys.authStateKey)!;
    f.session.setItem(keys.authNonceKey, "expected-nonce");
    window.location.href = `https://wildstat.example/game?code=one&state=${state}`;
    await f.service.restoreKnownAccount();
    expect(dpopHeader(request)).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.parse(f.local.getItem(`${keys.accountTokenKey}:refresh`)!)).toMatchObject({ token: "bound-grant", jkt: (await dpop.key())!.jkt, dpopStore: "idb" });
    expect(recordCarriedConnectionDiagnostic).toHaveBeenCalledWith("session-blocked", { detail: expect.stringMatching(/^sign-in-return:success:known-account:silent:\d+s:dpop=bound:idb$/) });
  });
  it("binds to the localStorage backup key when IndexedDB is unavailable, and says so once", async () => {
    const request = new FakeTokenRequest(200, { id_token: accountToken(), refresh_token: "bound-grant", token_type: "DPoP" });
    stubTokenRequests(request);
    let local: Storage | undefined;
    const dpop = createDpop({ indexedDB: null, subtle: crypto.subtle, backupStorage: () => local });
    const f = setup({ authCallback: true, dpop }); local = f.local;
    await f.service.restoreKnownAccount();
    expect(dpopHeader(request)).toBeDefined();
    expect(JSON.parse(f.local.getItem(`${keys.accountTokenKey}:refresh`)!)).toMatchObject({ dpopStore: "local", jkt: (await dpop.key())!.jkt });
    expect(recordCarriedConnectionDiagnostic).toHaveBeenCalledWith("session-blocked", { detail: "dpop-key:local-fallback:no-idb" });
  });
  it("starts loading the device key as soon as the service starts", () => {
    const dpop = createDpop({ indexedDB: fakeIndexedDB().indexedDB, subtle: crypto.subtle });
    const warm = vi.spyOn(dpop, "warm");
    setup({ dpop });
    expect(warm).toHaveBeenCalledOnce();
  });
  it("signs in without DPoP when the provider refuses the proof, noting the fallback", async () => {
    const dpop = createDpop({ indexedDB: fakeIndexedDB().indexedDB, subtle: crypto.subtle });
    const refused = new FakeTokenRequest(400, { error: "invalid_dpop_proof" });
    const plain = new FakeTokenRequest(200, { id_token: accountToken(), refresh_token: "plain-grant", token_type: "Bearer" });
    stubTokenRequests(refused, plain);
    const f = setup({ authCallback: true, dpop });
    f.local.setItem(DPOP_SWITCH_KEY, "on");
    await f.service.restoreKnownAccount();
    expect(dpopHeader(refused)).toBeDefined();
    expect(dpopHeader(plain)).toBeUndefined();
    expect(f.service.api.accountState().notice).toBe("SIGNED IN");
    expect(JSON.parse(f.local.getItem(`${keys.accountTokenKey}:refresh`)!).jkt).toBeUndefined();
    expect(recordCarriedConnectionDiagnostic).toHaveBeenCalledWith("session-blocked", { detail: "dpop-fallback:exchange:invalid_dpop_proof" });
  });
  it("times out a stalled exchange after 15 s with DPoP on, as without it", async () => {
    const dpop = createDpop({ indexedDB: fakeIndexedDB().indexedDB, subtle: crypto.subtle });
    const request = new FakeTokenRequest(0, {}, false);
    stubTokenRequests(request);
    const f = setup({ authCallback: true, knownAccount: true, dpop });
    const restore = f.service.restoreKnownAccount();
    await vi.waitFor(() => expect(request.send).toHaveBeenCalled());
    expect(dpopHeader(request)).toBeDefined();
    expect(request.timeout).toBe(15_000);
    request.ontimeout?.({} as ProgressEvent);
    await restore;
    expect(f.service.api.accountState()).toMatchObject({ authInProgress: false, notice: "SIGN-IN TIMED OUT · TRY AGAIN" });
  });
  it("sends no DPoP header on a browser that opted out", async () => {
    const dpop = createDpop({ indexedDB: fakeIndexedDB().indexedDB, subtle: crypto.subtle });
    const request = new FakeTokenRequest(200, { id_token: accountToken(), refresh_token: "grant" });
    stubTokenRequests(request);
    const f = setup({ authCallback: true, dpop });
    f.local.setItem(DPOP_SWITCH_KEY, "off");
    await f.service.restoreKnownAccount();
    expect(dpopHeader(request)).toBeUndefined();
    expect(f.local.getItem(`${keys.accountTokenKey}:refresh`)).not.toContain("jkt");
  });
});

describe("an account whose refresh grant runs out", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.mocked(recordCarriedConnectionDiagnostic).mockClear(); vi.mocked(recordConnectionDiagnostic).mockClear(); });
  const expiredToken = () => accountToken({ iat: Math.floor(Date.now() / 1000) - 7_200, exp: Math.floor(Date.now() / 1000) - 60 });
  it("keeps a connected session playing when renewing ahead is refused", async () => {
    vi.useFakeTimers({ now: Date.now() });
    vi.stubGlobal("document", { hidden: false });
    vi.stubGlobal("navigator", { onLine: true });
    const f = setup({ accountToken: accountToken({ iat: Math.floor(Date.now() / 1000) - 3_000, exp: Math.floor(Date.now() / 1000) + 600 }), knownAccount: true, signedIn: true });
    f.local.setItem(`${keys.accountTokenKey}:refresh`, JSON.stringify({ subject: "account-subject", token: "spent", savedAt: Date.now() - 3_000_000 }));
    const fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) }));
    vi.stubGlobal("fetch", fetch);
    f.service.markPlayable(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(recordConnectionDiagnostic).toHaveBeenCalledWith("session-blocked", { detail: expect.stringMatching(/^renew-ahead-refused:/) });
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
    await expect(f.service.connectionToken(old)).rejects.toMatchObject({ reason: "no-grant" });
    expect(f.assign).not.toHaveBeenCalled();
    expect(f.service.canConnect()).toBe(false);
    expect(vi.mocked(recordCarriedConnectionDiagnostic).mock.calls.filter(([, d]) => String(d?.detail).startsWith("renewal-deferred:no-grant"))).toHaveLength(1);
    // The visible tab signed in again meanwhile.
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
    expect(recordCarriedConnectionDiagnostic).toHaveBeenCalledWith("session-blocked", { detail: "renewal-refused:no-grant:" });
    expect(f.assign).toHaveBeenCalledOnce();
    expect(JSON.parse(f.session.getItem(keys.authTripKey)!)).toMatchObject({ reason: "renewal-no-grant", prompt: false });
  });
});

it("tells Settings an account is stored even while disconnected", () => {
  const { service } = setup({ accountToken: accountToken(), knownAccount: true });
  expect(service.api.accountState()).toMatchObject({ signedIn: false, hasAccountToken: true });
  expect(setup({ guestToken: "guest" }).service.api.accountState().hasAccountToken).toBe(false);
});

describe("Sign In and Register never do nothing", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each([null, "account"] as const)("a signed-in account reloaded (update resume: %s) comes back to its character", async mode => {
    const f = setup({ accountToken: accountToken(), knownAccount: true, updateResumeMode: mode });
    f.local.setItem(keys.knownAccountCharacterKey, "Pilidria");
    await f.service.restoreKnownAccount();
    expect(f.service.api.accountState()).toMatchObject({ knownAccount: true });
    expect(f.service.api.knownCharacter()).toBe("Pilidria");
    if (mode) expect(f.connect).toHaveBeenCalledOnce();
    else expect(f.service.api.accountState()).toMatchObject({ signInRequired: true, notice: "SIGN-IN REQUIRED" });
  });

  it("a reload after the server refused the token still offers SIGN IN to the character", async () => {
    const f = setup({ knownAccount: true });
    f.local.setItem(keys.knownAccountCharacterKey, "Pilidria");
    await f.service.restoreKnownAccount();
    expect(f.service.api.accountState()).toMatchObject({ knownAccount: true, signInRequired: true, signInReady: true });
    expect(f.service.api.knownCharacter()).toBe("Pilidria");
    expect(await f.service.api.signIn()).toMatchObject({ ok: true, redirecting: true });
    expect(f.assign).toHaveBeenCalledOnce();
  });

  it("reports a sign-in that was cancelled before it left, instead of waiting forever", async () => {
    const f = setup();
    // Anything that drops the trip mid-start (a back-forward restore, Guest) leaves this page here.
    f.notify.mockImplementation(() => {
      if (f.service.api.accountState().returningFromSignIn) f.service.cancelAbandonedSignIn();
    });
    const result = await f.service.api.signIn();
    expect(f.assign).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false });
    f.notify.mockReset();
    expect(await f.service.api.signIn()).toMatchObject({ ok: true, redirecting: true });
    expect(f.assign).toHaveBeenCalledOnce();
  });

  it("does not keep a guest link pending when its sign-in never left", async () => {
    const f = setup({ guestToken: "existing-guest" });
    f.setConnection({ isActive: true, disconnect: vi.fn(), reducers: { beginAccountLink: vi.fn(async () => {}) } } as never);
    f.notify.mockImplementation(() => {
      if (f.service.api.accountState().returningFromSignIn) f.service.cancelAbandonedSignIn();
    });
    expect(await f.service.api.signIn()).toMatchObject({ ok: false });
    expect(f.session.getItem(keys.accountLinkKey)).toBeNull();
    expect(f.service.accountMigrationPending()).toBe(false);
  });

  it("reloads a sign-out page brought back from the back-forward cache", async () => {
    const f = setup({ accountToken: accountToken(), knownAccount: true, signedIn: true });
    const listeners: Record<string, ((event: { persisted?: boolean }) => void)[]> = {};
    Object.assign(window, { addEventListener: (type: string, listener: (event: { persisted?: boolean }) => void) => { (listeners[type] ??= []).push(listener); } });
    await f.service.api.signOut();
    expect(await f.service.api.signIn()).toMatchObject({ ok: false, error: "SIGNING OUT" });
    for (const listener of listeners.pageshow ?? []) listener({ persisted: false });
    expect(window.location.reload).not.toHaveBeenCalled();
    for (const listener of listeners.pageshow ?? []) listener({ persisted: true });
    expect(window.location.reload).toHaveBeenCalledOnce();
  });

  it("reloads a sign-out whose page never left", async () => {
    vi.useFakeTimers();
    const f = setup({ accountToken: accountToken(), knownAccount: true, signedIn: true });
    await f.service.api.signOut();
    vi.advanceTimersByTime(14_000);
    expect(window.location.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(window.location.reload).toHaveBeenCalledOnce();
  });
});
