import { describe, expect, it, vi } from "vitest";
import { fakeIndexedDB } from "../../../tests/helpers/fake-indexeddb";
import { createDpop, dpopSwitchOn, dpopWanted, exchangeCodeWithDpop, sendWithDpop, DPOP_SWITCH_KEY, type TokenAttempt } from "./account-dpop";

const ENDPOINT = "https://auth.spacetimedb.com/oidc/token";
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
function memory(values: Record<string, string> = {}) {
  const map = new Map(Object.entries(values));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}
function dpopFor(db = fakeIndexedDB(), nowMs = () => 1_700_000_000_000) {
  return createDpop({ indexedDB: db.indexedDB, subtle: crypto.subtle, nowMs });
}
async function verifies(proof: string) {
  const [header, payload, signature] = proof.split(".");
  const key = await crypto.subtle.importKey("jwk", decode(header).jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${payload}`));
}

describe("DPoP proofs", () => {
  it("signs an ES256 proof with the device's public key for the token endpoint without query or fragment", async () => {
    const dpop = dpopFor();
    const key = (await dpop.key(true))!;
    expect(key.privateKey.extractable).toBe(false);
    const proof = await dpop.proof(key, "POST", `${ENDPOINT}?x=1#frag`);
    const [header, payload] = proof.split(".").slice(0, 2).map(decode);
    expect(header).toEqual({ typ: "dpop+jwt", alg: "ES256", jwk: { kty: "EC", crv: "P-256", x: expect.any(String), y: expect.any(String) } });
    expect(payload).toEqual({ jti: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), htm: "POST", htu: ENDPOINT, iat: 1_700_000_000 });
    expect(await verifies(proof)).toBe(true);
    const again = decode((await dpop.proof(key, "POST", ENDPOINT)).split(".")[1]);
    expect(again.jti).not.toBe(payload.jti);
    // RFC 7638 thumbprint of the header key.
    const { crv, kty, x, y } = header.jwk;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ crv, kty, x, y })));
    expect(key.jkt).toBe(Buffer.from(digest).toString("base64url"));
  });
  it("retries once with the provider's nonce and keeps using it", async () => {
    const dpop = dpopFor(); const key = (await dpop.key(true))!;
    const proofs: string[] = [];
    const send = vi.fn(async (proof: string): Promise<TokenAttempt> => {
      proofs.push(proof);
      return proofs.length === 1 ? { ok: false, result: { error: "use_dpop_nonce" }, nonce: "n-1" } : { ok: true, result: {}, nonce: null };
    });
    expect((await sendWithDpop(dpop, key, ENDPOINT, send)).ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(decode(proofs[0].split(".")[1]).nonce).toBeUndefined();
    expect(decode(proofs[1].split(".")[1]).nonce).toBe("n-1");
    expect(decode((await dpop.proof(key, "POST", ENDPOINT)).split(".")[1]).nonce).toBe("n-1");
  });
});

describe("DPoP device key", () => {
  it("makes one key per browser, shared by tabs that ask at the same moment", async () => {
    const db = fakeIndexedDB();
    const generate = vi.spyOn(crypto.subtle, "generateKey");
    const tabA = dpopFor(db), tabB = dpopFor(db);
    const [a1, a2, b] = await Promise.all([tabA.key(true), tabA.key(true), tabB.key(true)]);
    expect(a1!.jkt).toBe(b!.jkt);
    expect(a2).toBe(a1);
    expect(generate.mock.calls.length).toBeLessThanOrEqual(2);       // one per tab at most, never per call
    const later = dpopFor(db);
    expect((await later.key(false))!.jkt).toBe(a1!.jkt);
    generate.mockRestore();
  });
  it("only reads when asked not to create: null once the key is gone", async () => {
    const db = fakeIndexedDB();
    expect(await dpopFor(db).key(false)).toBeNull();
    await dpopFor(db).key(true);
    db.clear();
    expect(await dpopFor(db).key(false)).toBeNull();
  });
  it("falls back to no key without WebCrypto or IndexedDB", async () => {
    const none = createDpop({ indexedDB: null, subtle: crypto.subtle });
    expect(await none.key(true)).toBeNull();
    await expect(none.key(false)).rejects.toThrow("unavailable");
    expect(await createDpop({ indexedDB: fakeIndexedDB().indexedDB, subtle: null }).key(true)).toBeNull();
  });
});

describe("DPoP rollout switch", () => {
  it("is off unless this browser turned it on", () => {
    expect(dpopSwitchOn(memory())).toBe(false);
    expect(dpopSwitchOn(memory({ [DPOP_SWITCH_KEY]: "yes" }))).toBe(false);
    expect(dpopSwitchOn(memory({ [DPOP_SWITCH_KEY]: "on" }))).toBe(true);
    expect(dpopSwitchOn(undefined)).toBe(false);
  });
});

describe("code exchange with DPoP", () => {
  type Attempt = TokenAttempt & { result: { error?: unknown; token_type?: unknown } };
  const ok = (tokenType = "DPoP"): Attempt => ({ ok: true, result: { token_type: tokenType }, nonce: null });
  const networkFailure = (error: unknown) => error instanceof TypeError;
  it("sends no proof and touches no key while the switch is off", async () => {
    const dpop = dpopFor(); const key = vi.spyOn(dpop, "key");
    const send = vi.fn(async (_proof?: string) => ok("Bearer"));
    const exchange = await exchangeCodeWithDpop({ dpop, storage: memory(), endpoint: ENDPOINT, send, networkFailure });
    expect(send.mock.calls[0][0]).toBeUndefined();
    expect(key).not.toHaveBeenCalled();
    expect(exchange).toMatchObject({ label: "off" });
    expect(exchange.jkt).toBeUndefined();
  });
  it("binds the sign-in when the provider answers with a DPoP token", async () => {
    const dpop = dpopFor(); const send = vi.fn(async (_proof?: string) => ok());
    const exchange = await exchangeCodeWithDpop({ dpop, storage: memory({ [DPOP_SWITCH_KEY]: "on" }), endpoint: ENDPOINT, send, networkFailure });
    expect(await verifies(send.mock.calls[0][0]!)).toBe(true);
    expect(exchange).toMatchObject({ label: "bound", jkt: (await dpop.key(false))!.jkt });
  });
  it("is unbound when the provider ignores the proof", async () => {
    const exchange = await exchangeCodeWithDpop({ dpop: dpopFor(), storage: memory({ [DPOP_SWITCH_KEY]: "on" }), endpoint: ENDPOINT,
      send: async () => ok("Bearer"), networkFailure });
    expect(exchange.label).toBe("unbound"); expect(exchange.jkt).toBeUndefined();
  });
  it("signs in without DPoP when the proof is refused, and stops trying it on this browser for a while", async () => {
    const storage = memory({ [DPOP_SWITCH_KEY]: "on" });
    const send = vi.fn(async (proof?: string): Promise<Attempt> => proof ? { ok: false, result: { error: "invalid_dpop_proof" }, nonce: null } : ok("Bearer"));
    const exchange = await exchangeCodeWithDpop({ dpop: dpopFor(), storage, endpoint: ENDPOINT, send, networkFailure });
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0]).toBeUndefined();
    expect(exchange).toMatchObject({ label: "unbound", fallback: "invalid_dpop_proof", attempt: { ok: true } });
    expect(dpopWanted(storage)).toBe(false);
  });
  it("retries without the header when only the DPoP request fails on the network (CORS)", async () => {
    const storage = memory({ [DPOP_SWITCH_KEY]: "on" });
    const send = vi.fn(async (proof?: string) => { if (proof) throw new TypeError("Failed to fetch"); return ok("Bearer"); });
    const exchange = await exchangeCodeWithDpop({ dpop: dpopFor(), storage, endpoint: ENDPOINT, send, networkFailure });
    expect(exchange).toMatchObject({ label: "unbound", fallback: "network" });
    expect(dpopWanted(storage)).toBe(false);
  });
  it("keeps DPoP on when the network is simply down", async () => {
    const storage = memory({ [DPOP_SWITCH_KEY]: "on" });
    const send = vi.fn(async (): Promise<Attempt> => { throw new TypeError("Failed to fetch"); });
    await expect(exchangeCodeWithDpop({ dpop: dpopFor(), storage, endpoint: ENDPOINT, send, networkFailure })).rejects.toThrow("Failed to fetch");
    expect(dpopWanted(storage)).toBe(true);
  });
  it("leaves grant errors alone: an invalid code is not retried", async () => {
    const send = vi.fn(async (): Promise<Attempt> => ({ ok: false, result: { error: "invalid_grant" }, nonce: null }));
    const exchange = await exchangeCodeWithDpop({ dpop: dpopFor(), storage: memory({ [DPOP_SWITCH_KEY]: "on" }), endpoint: ENDPOINT, send, networkFailure });
    expect(send).toHaveBeenCalledOnce(); expect(exchange.attempt.ok).toBe(false);
  });
  it("signs in plainly when this browser cannot keep a key", async () => {
    const send = vi.fn(async (_proof?: string) => ok("Bearer"));
    const exchange = await exchangeCodeWithDpop({ dpop: createDpop({ indexedDB: null, subtle: crypto.subtle }), storage: memory({ [DPOP_SWITCH_KEY]: "on" }),
      endpoint: ENDPOINT, send, networkFailure });
    expect(send.mock.calls[0][0]).toBeUndefined();
    expect(exchange).toMatchObject({ label: "unbound", fallback: "no-key" });
  });
});

describe("DPoP key storage that hangs", () => {
  it("gives up after a few seconds instead of holding the renewal lock", async () => {
    vi.useFakeTimers();
    const stuck = { open: () => ({}) } as unknown as IDBFactory;          // never answers
    const dpop = createDpop({ indexedDB: stuck, subtle: crypto.subtle });
    const read = expect(dpop.key(false)).rejects.toThrow("timed out");
    const create = dpop.key(true);
    await vi.advanceTimersByTimeAsync(5_000);
    await read; expect(await create).toBeNull();
    vi.useRealTimers();
  });
});
