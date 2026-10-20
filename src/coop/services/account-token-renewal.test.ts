import { afterEach, describe, expect, it, vi } from "vitest";
import { SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../../shared/rules";
import { inspectSpacetimeIdToken } from "../security/oidc-id-token";
vi.mock("../security/oidc-id-token", async importOriginal => {
  const actual = await importOriginal<typeof import("../security/oidc-id-token")>();
  return { ...actual, verifySpacetimeIdToken: vi.fn(async (token: string) => actual.inspectSpacetimeIdToken(token)) };
});
import { AccountRenewalRequired, createAccountTokenRenewal } from "./account-token-renewal";
import { verifySpacetimeIdToken } from "../security/oidc-id-token";
import { createDpop, dpopWanted, DPOP_SWITCH_KEY } from "./account-dpop";
import { fakeIndexedDB } from "../../../tests/helpers/fake-indexeddb";
function token(exp: number, sub = "player-a") {
  const encode = (v: unknown) => btoa(JSON.stringify(v)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "RS256", kid: "test" })}.${encode({ iss: SPACETIME_AUTH_ISSUER, aud: SPACETIME_AUTH_CLIENT_ID, sub, iat: 100, exp })}.c2ln`;
}
function issued(iat: number, exp: number, sub = "player-a") {
  const encode = (v: unknown) => btoa(JSON.stringify(v)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "RS256", kid: "test" })}.${encode({ iss: SPACETIME_AUTH_ISSUER, aud: SPACETIME_AUTH_CLIENT_ID, sub, iat, exp })}.c2ln`;
}
const expired = () => token(Date.now() / 1000 - 60);
const fresh = () => token(Date.now() / 1000 + 3600);
function setup() {
  const values = new Map<string, string>();
  const storage = { get length() { return values.size; }, clear: () => values.clear(), key: (index: number) => [...values.keys()][index] ?? null, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } as Storage;
  const renewal = createAccountTokenRenewal(storage, "account");
  const old = expired();
  storage.setItem("account", old);
  storage.setItem("account:refresh", JSON.stringify({ subject: "player-a", token: "refresh-original" }));
  return { renewal, storage, old };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("account credential renewal", () => {
  it("renews an expired login once for simultaneous map/account reconnects and rotates the grant", async () => {
    const s = setup(); const updated = fresh();
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => ({ ok: true, json: async () => ({ id_token: updated, refresh_token: "refresh-rotated" }) }));
    vi.stubGlobal("fetch", fetch);
    expect(await Promise.all([s.renewal.resolve(s.old), s.renewal.resolve(s.old)])).toEqual([updated, updated]);
    expect(fetch).toHaveBeenCalledOnce();
    expect((fetch.mock.calls[0][1].body as URLSearchParams).get("grant_type")).toBe("refresh_token");
    expect(s.storage.getItem("account:refresh")).toContain("refresh-rotated");
    expect(await s.renewal.resolve(s.old)).toBe(updated);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("uses a newer token for the same account without refreshing an old root token again", async () => {
    const s = setup(); const updated = fresh(); s.storage.setItem("account", updated);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await s.renewal.resolve(s.old, true)).toBe(updated); expect(fetch).not.toHaveBeenCalled();
  });
  it("forces one renewal when a still-valid token is rejected by the server", async () => {
    const s = setup(); const before = fresh(); s.storage.setItem("account", before);
    const updated = token(Date.now() / 1000 + 7200);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id_token: updated }) })));
    expect(await s.renewal.resolve(before, true)).toBe(updated);
    expect(s.storage.getItem("account:refresh")).toContain("refresh-original");
  });
  it("retains credentials after an outage so the next attempt can recover", async () => {
    const s = setup(); vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: "temporarily_unavailable" }) })));
    await expect(s.renewal.resolve(s.old)).rejects.toThrow("temporarily unavailable");
    expect(s.storage.getItem("account")).toBe(s.old); expect(s.storage.getItem("account:refresh")).toContain("refresh-original");
  });
  it("does not silently change identity when another tab changes accounts", async () => {
    const s = setup(); s.storage.setItem("account", token(Date.now() / 1000 + 3600, "player-b"));
    await expect(s.renewal.resolve(s.old)).rejects.toThrow("Account changed");
  });
  it("rejects refreshed tokens for a different subject", async () => {
    const s = setup(); vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id_token: token(Date.now() / 1000 + 3600, "player-b") }) })));
    await expect(s.renewal.resolve(s.old)).rejects.toThrow("Account changed"); expect(s.storage.getItem("account")).toBe(s.old);
  });
  it("does not restore credentials if the player signs out during renewal", async () => {
    const s = setup(); let finish!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
    const result = s.renewal.resolve(s.old);
    s.storage.removeItem("account"); s.renewal.clear();
    finish({ ok: true, json: async () => ({ id_token: fresh(), refresh_token: "new" }) });
    await expect(result).rejects.toThrow("Account changed"); expect(s.storage.getItem("account")).toBeNull();
  });
  it("requires one new sign-in for legacy sessions or revoked grants, preserving the identity", async () => {
    const s = setup(); s.renewal.clear();
    await expect(s.renewal.resolve(s.old)).rejects.toBeInstanceOf(AccountRenewalRequired);
    expect(s.renewal.stored()).toBe(s.old);
    s.storage.setItem("account:refresh", JSON.stringify({ subject: "player-a", token: "revoked" }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) })));
    await expect(s.renewal.resolve(s.old)).rejects.toBeInstanceOf(AccountRenewalRequired);
    expect(s.storage.getItem("account:refresh")).toBeNull(); expect(s.renewal.stored()).toBe(s.old);
  });
  it("keeps the rotated grant when the answer arrives after the connection stopped waiting", async () => {
    vi.useFakeTimers({ now: Date.now() });
    const s = setup(); const updated = fresh(); let answer!: (v: unknown) => void;
    const fetch = vi.fn(() => new Promise(resolve => { answer = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const first = s.renewal.resolve(s.old);
    const timedOut = expect(first).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000); await timedOut;
    // A retry joins the request in flight rather than spending the old grant again.
    const retry = s.renewal.resolve(s.old);
    answer({ ok: true, json: async () => ({ id_token: updated, refresh_token: "refresh-rotated" }) });
    expect(await retry).toBe(updated);
    expect(fetch).toHaveBeenCalledOnce();
    expect(s.storage.getItem("account:refresh")).toContain("refresh-rotated");
    vi.useRealTimers();
  });
  it("names why renewal needs a new sign-in", async () => {
    const s = setup(); s.renewal.clear();
    await expect(s.renewal.resolve(s.old)).rejects.toMatchObject({ reason: "no-grant" });
    s.storage.setItem("account:refresh", JSON.stringify({ subject: "player-a", token: "spent" }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) })));
    await expect(s.renewal.resolve(s.old)).rejects.toMatchObject({ reason: "grant-rejected" });
  });
  it("renews ahead once three quarters of the token's life has passed since it arrived, sharing one request", async () => {
    const s = setup(); const nowMs = Date.now(), now = nowMs / 1000;
    const updated = issued(now, now + 3600);
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id_token: updated, refresh_token: "refresh-rotated" }) }));
    vi.stubGlobal("fetch", fetch);
    const current = issued(now - 1800, now + 1800);
    s.storage.setItem("account", current);
    s.storage.setItem("account:refresh", JSON.stringify({ subject: "player-a", token: "refresh-original", savedAt: nowMs - 1_800_000 }));
    expect(await s.renewal.renewAhead(nowMs)).toBeNull();                      // half its hour used
    expect(fetch).not.toHaveBeenCalled();
    s.storage.setItem("account:refresh", JSON.stringify({ subject: "player-a", token: "refresh-original", savedAt: nowMs - 2_760_000 }));
    expect(await Promise.all([s.renewal.renewAhead(nowMs), s.renewal.resolve(current)])).toEqual([updated, current]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(s.storage.getItem("account")).toBe(updated);
    expect(JSON.parse(s.storage.getItem("account:refresh")!)).toMatchObject({ token: "refresh-rotated" });
  });
  it("does not renew ahead on a device clock running an hour fast, or without a refresh grant", async () => {
    const s = setup(); const nowMs = Date.now(), now = nowMs / 1000;
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    // Issued a minute ago by the provider's clock, but already "expired" by a fast local one.
    s.storage.setItem("account", issued(now - 3660, now - 60));
    s.storage.setItem("account:refresh", JSON.stringify({ subject: "player-a", token: "refresh-original", savedAt: nowMs - 60_000 }));
    expect(await s.renewal.renewAhead(nowMs)).toBeNull();
    s.renewal.clear();
    s.storage.setItem("account", issued(now - 3500, now + 100));
    expect(await s.renewal.renewAhead(nowMs)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps the rotated refresh token when checking the new ID token fails", async () => {
    const s = setup();
    vi.mocked(verifySpacetimeIdToken).mockRejectedValueOnce(new Error("signing keys unavailable"));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id_token: fresh(), refresh_token: "refresh-rotated" }) })));
    await expect(s.renewal.resolve(s.old)).rejects.toThrow("signing keys unavailable");
    // The spent token would revoke the sign-in; the next attempt uses the new one.
    expect(JSON.parse(s.storage.getItem("account:refresh")!)).toMatchObject({ subject: "player-a", token: "refresh-rotated" });
    expect(s.storage.getItem("account")).toBe(s.old);
  });
  it("marks the tab while the provider holds the request, and clears it however it ends", async () => {
    const tab = new Map<string, string>();
    const tabStorage = { getItem: (k: string) => tab.get(k) ?? null, setItem: (k: string, v: string) => void tab.set(k, v), removeItem: (k: string) => void tab.delete(k) };
    const s = setup(); const renewal = createAccountTokenRenewal(s.storage, "account", tabStorage);
    let answer!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { answer = resolve; })));
    const result = renewal.resolve(s.old);
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    expect(tab.get("wildstat:account-renewal-started-at")).toBeDefined();
    answer({ ok: false, status: 503, json: async () => ({ error: "temporarily_unavailable" }) });
    await expect(result).rejects.toThrow("temporarily unavailable");
    expect(tab.has("wildstat:account-renewal-started-at")).toBe(false);
  });
  it("says how old the refused grant was, and whether the page before this one left mid-renewal", async () => {
    const tab = new Map<string, string>([["wildstat:account-renewal-started-at", String(Date.now() - 5_000)]]);
    const tabStorage = { getItem: (k: string) => tab.get(k) ?? null, setItem: (k: string, v: string) => void tab.set(k, v), removeItem: (k: string) => void tab.delete(k) };
    const s = setup();
    s.storage.setItem("account:refresh", JSON.stringify({ subject: "player-a", token: "spent", savedAt: Date.now() - 2 * 3_600_000 }));
    const renewal = createAccountTokenRenewal(s.storage, "account", tabStorage);
    expect(tab.size).toBe(0);                                         // the leftover is read once and cleared
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "grant request is invalid" }) })));
    const refused = await renewal.resolve(s.old).catch(error => error);
    expect(refused).toBeInstanceOf(AccountRenewalRequired);
    expect(refused.detail).toMatch(/^grant-age=2\.0h;chain-age=unknown;token-age=\d+\.\dh;auth-age=unknown;interrupted=yes;dpop=off;desc=grant request is invalid$/);
  });
  it("says how long ago the sign-in that started the refresh chain was, across rotations", async () => {
    const s = setup(); const nowMs = Date.now();
    s.storage.setItem("account:refresh", JSON.stringify({ subject: "player-a", token: "refresh-original", savedAt: nowMs - 3_600_000, chainAt: nowMs - 23 * 3_600_000 }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id_token: fresh(), refresh_token: "refresh-rotated" }) })));
    await s.renewal.resolve(s.old);
    expect(JSON.parse(s.storage.getItem("account:refresh")!)).toMatchObject({ token: "refresh-rotated", chainAt: nowMs - 23 * 3_600_000 });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) })));
    const refused = await s.renewal.resolve(s.storage.getItem("account")!, true).catch(error => error);
    expect(refused.detail).toMatch(/;chain-age=23\.0h;/);
    // A new sign-in starts a new chain.
    s.renewal.save(fresh(), "refresh-new");
    expect(JSON.parse(s.storage.getItem("account:refresh")!).chainAt).toBeGreaterThanOrEqual(nowMs);
  });
  it("keeps the login through a network failure or a non-JSON error page, and renews with it next time", async () => {
    const s = setup(); const updated = fresh();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(s.renewal.resolve(s.old)).rejects.toThrow("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token <"); } })));
    await expect(s.renewal.resolve(s.old)).rejects.toThrow(SyntaxError);
    expect(s.renewal.stored()).toBe(s.old);
    expect(s.storage.getItem("account:refresh")).toContain("refresh-original");
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => ({ ok: true, json: async () => ({ id_token: updated, refresh_token: "refresh-rotated" }) }));
    vi.stubGlobal("fetch", fetch);
    expect(await s.renewal.resolve(s.old)).toBe(updated);
    expect((fetch.mock.calls[0][1].body as URLSearchParams).get("refresh_token")).toBe("refresh-original");
  });
  it("clears only the refresh grant on invalid_grant, keeping the account for the next sign-in", async () => {
    const s = setup();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) })));
    await expect(s.renewal.resolve(s.old)).rejects.toMatchObject({ reason: "grant-rejected" });
    expect(s.storage.getItem("account:refresh")).toBeNull();
    expect(s.renewal.stored()).toBe(s.old);
    // Nothing left to spend: the next attempt asks for a sign-in without calling the provider.
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(s.renewal.resolve(s.old)).rejects.toMatchObject({ reason: "no-grant" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("spends the refresh token once across tabs: the tab that waited on the lock uses the other tab's result", async () => {
    // One Web Lock queue per name, shared by both "tabs" as the browser shares it per origin.
    const queues = new Map<string, Promise<unknown>>();
    vi.stubGlobal("navigator", { locks: { request: (name: string, run: () => Promise<unknown>) => {
      const result = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(run);
      queues.set(name, result);
      return result;
    } } });
    const s = setup(); const tabB = createAccountTokenRenewal(s.storage, "account");
    const updated = fresh(); let answer!: (v: unknown) => void;
    const fetch = vi.fn(() => new Promise(resolve => { answer = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const a = s.renewal.resolve(s.old), b = tabB.resolve(s.old);
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    answer({ ok: true, json: async () => ({ id_token: updated, refresh_token: "refresh-rotated" }) });
    expect(await Promise.all([a, b])).toEqual([updated, updated]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(s.storage.getItem("account:refresh")!)).toMatchObject({ token: "refresh-rotated" });
  });
  it("never permits expired tokens through the normal ID token validator", () => {
    expect(() => inspectSpacetimeIdToken(expired())).toThrow();
  });
});

describe("DPoP-bound refresh", () => {
  const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  const headersOf = (call: unknown[]) => (call[1] as RequestInit).headers as Record<string, string>;
  async function bound(switchOn = true) {
    const s = setup(); const db = fakeIndexedDB();
    const dpop = createDpop({ indexedDB: db.indexedDB, subtle: crypto.subtle });
    const report = vi.fn();
    const renewal = createAccountTokenRenewal(s.storage, "account", undefined, { dpop: () => dpop, report });
    if (switchOn) s.storage.setItem(DPOP_SWITCH_KEY, "on");
    const key = (await dpop.key(true))!;
    s.storage.setItem("account:refresh", JSON.stringify({ subject: "player-a", token: "refresh-bound", jkt: key.jkt, chainAt: Date.now() - 3_600_000 }));
    return { ...s, renewal, dpop, db, key, report };
  }
  const okAnswer = (id: string) => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ id_token: id, refresh_token: "refresh-rotated", token_type: "DPoP" }) });
  it("always refreshes a bound token with a proof from the same key, even with the switch off, and keeps it bound", async () => {
    const s = await bound(false); const updated = fresh();
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => okAnswer(updated));
    vi.stubGlobal("fetch", fetch);
    expect(await s.renewal.resolve(s.old)).toBe(updated);
    const proof = headersOf(fetch.mock.calls[0]).DPoP;
    expect(decode(proof.split(".")[0]).jwk).toEqual(s.key.jwk);
    expect(decode(proof.split(".")[1])).toMatchObject({ htm: "POST", htu: `${SPACETIME_AUTH_ISSUER}/token` });
    expect(JSON.parse(s.storage.getItem("account:refresh")!)).toMatchObject({ token: "refresh-rotated", jkt: s.key.jkt });
  });
  it("refreshes an unbound token without DPoP, even with the switch on", async () => {
    const s = await bound(); s.storage.setItem("account:refresh", JSON.stringify({ subject: "player-a", token: "refresh-old" }));
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => okAnswer(fresh()));
    vi.stubGlobal("fetch", fetch);
    await s.renewal.resolve(s.old);
    expect(headersOf(fetch.mock.calls[0]).DPoP).toBeUndefined();
    expect(JSON.parse(s.storage.getItem("account:refresh")!).jkt).toBeUndefined();
  });
  it("asks for a sign-in when the key a token is bound to is gone, without spending the token", async () => {
    const s = await bound(); s.db.clear();
    const renewal = createAccountTokenRenewal(s.storage, "account", undefined, { dpop: () => createDpop({ indexedDB: s.db.indexedDB, subtle: crypto.subtle }) });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const refused = await renewal.resolve(s.old).catch(error => error);
    expect(refused).toMatchObject({ reason: "grant-rejected" });
    expect(refused.detail).toMatch(/;dpop=bound;desc=dpop-key-lost$/);
    expect(fetch).not.toHaveBeenCalled();
    expect(s.storage.getItem("account:refresh")).toBeNull();
  });
  it("retries with the provider's nonce, presenting the same refresh token", async () => {
    const s = await bound(); const updated = fresh();
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => fetch.mock.calls.length === 1
      ? { ok: false, status: 400, headers: new Headers({ "DPoP-Nonce": "nonce-1" }), json: async () => ({ error: "use_dpop_nonce" }) }
      : okAnswer(updated));
    vi.stubGlobal("fetch", fetch);
    expect(await s.renewal.resolve(s.old)).toBe(updated);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(decode(headersOf(fetch.mock.calls[1]).DPoP.split(".")[1]).nonce).toBe("nonce-1");
    expect((fetch.mock.calls[1][1].body as URLSearchParams).get("refresh_token")).toBe("refresh-bound");
  });
  it("ends the sign-in when the provider keeps refusing the proof, and binds no new sign-in for a while", async () => {
    const s = await bound();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, headers: new Headers(), json: async () => ({ error: "invalid_dpop_proof", error_description: "bad" }) })));
    const refused = await s.renewal.resolve(s.old).catch(error => error);
    expect(refused).toMatchObject({ reason: "grant-rejected" });
    expect(refused.detail).toMatch(/;dpop=bound;desc=dpop-invalid_dpop_proof:bad$/);
    expect(dpopWanted(s.storage)).toBe(false);
  });
  it("reports once per day a chain keeps renewing, so a bound chain past 24 hours shows up", async () => {
    const s = await bound();
    s.storage.setItem("account:refresh", JSON.stringify({ subject: "player-a", token: "refresh-bound", jkt: s.key.jkt, chainAt: Date.now() - 25 * 3_600_000 }));
    vi.stubGlobal("fetch", vi.fn(async () => okAnswer(fresh())));
    await s.renewal.resolve(s.old);
    expect(s.report).toHaveBeenCalledWith(expect.stringMatching(/^renewal-chain:days=1;chain-age=25\.0h;dpop=bound$/));
    await s.renewal.resolve(s.storage.getItem("account")!, true);
    expect(s.report).toHaveBeenCalledOnce();
  });
  it("sends no DPoP header anywhere while the switch is off and the token is unbound", async () => {
    const s = setup(); const fetch = vi.fn(async (_url: string, _options: RequestInit) => okAnswer(fresh()));
    vi.stubGlobal("fetch", fetch);
    await s.renewal.resolve(s.old);
    expect(headersOf(fetch.mock.calls[0])).toEqual({ "content-type": "application/x-www-form-urlencoded" });
  });
});
