import { describe, expect, it, vi } from "vitest";
import { fakeIndexedDB } from "../../../tests/helpers/fake-indexeddb";
import { createDpop, DPOP_BACKUP_KEY, dpopSwitchOn, dpopWanted, exchangeCodeWithDpop, sendWithDpop, DPOP_SWITCH_KEY, type TokenAttempt } from "./account-dpop";

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
    const key = (await dpop.key())!;
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
    const dpop = dpopFor(); const key = (await dpop.key())!;
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
    const [a1, a2, b] = await Promise.all([tabA.key(), tabA.key(), tabB.key()]);
    expect(a1).toMatchObject({ store: "idb", jkt: b!.jkt });
    expect(a2).toBe(a1);
    expect(generate.mock.calls.length).toBeLessThanOrEqual(2);       // one per tab at most, never per call
    expect((await dpopFor(db).keyFor(a1!.jkt))!.jkt).toBe(a1!.jkt);
    generate.mockRestore();
  });
  it("finds a bound grant's key by thumbprint, and null once it is gone", async () => {
    const db = fakeIndexedDB();
    const { jkt } = (await dpopFor(db).key())!;
    expect(await dpopFor(db).keyFor("someone-else")).toBeNull();
    db.clear();
    expect(await dpopFor(db).keyFor(jkt)).toBeNull();
  });
  it("wakes Safari's IndexedDB by polling databases() until it answers", async () => {
    vi.useFakeTimers();
    const db = fakeIndexedDB({ asleepUntilPoll: 4 });
    const key = dpopFor(db).key();
    await vi.advanceTimersByTimeAsync(250);
    expect(db.polls()).toBe(3);                                         // one at once, then every 100 ms
    await vi.advanceTimersByTimeAsync(100);
    expect(await key).toMatchObject({ store: "idb" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(db.polls()).toBe(4);                                         // stops once awake
    vi.useRealTimers();
  });
  it("starts loading at page load, and a sign-in reuses that load", async () => {
    const db = fakeIndexedDB();
    const generate = vi.spyOn(crypto.subtle, "generateKey");
    const dpop = dpopFor(db);
    dpop.warm();
    const key = await dpop.key();
    expect(generate).toHaveBeenCalledOnce();
    expect(await dpop.key()).toBe(key);
    generate.mockRestore();
  });
  it("without WebCrypto there is no key at all", async () => {
    expect(await createDpop({ indexedDB: fakeIndexedDB().indexedDB, subtle: null }).key()).toBeNull();
  });
});

describe("DPoP backup key in localStorage", () => {
  const backupOn = (storage: ReturnType<typeof memory>, indexedDB: IDBFactory | null = null) =>
    createDpop({ indexedDB, subtle: crypto.subtle, backupStorage: () => storage });
  it("uses an extractable key kept as a JWK when IndexedDB is unavailable, and says why once", async () => {
    const storage = memory(); const dpop = backupOn(storage);
    const key = (await dpop.key())!;
    expect(key.store).toBe("local");
    expect(JSON.parse(storage.getItem(DPOP_BACKUP_KEY)!)).toMatchObject({ kty: "EC", crv: "P-256", d: expect.any(String), x: key.jwk.x });
    expect(await verifies(await dpop.proof(key, "POST", ENDPOINT))).toBe(true);
    expect(dpop.takeFallbackNote()).toBe("no-idb");
    expect(dpop.takeFallbackNote()).toBeNull();
    // Another page finds the same key by its thumbprint.
    expect((await backupOn(storage).keyFor(key.jkt))!.jkt).toBe(key.jkt);
  });
  it("keeps a grant bound to the backup key on that key after IndexedDB starts working; new sign-ins get the IndexedDB key", async () => {
    const storage = memory();
    const local = (await backupOn(storage).key())!;
    const db = fakeIndexedDB();
    const later = backupOn(storage, db.indexedDB);
    expect(await later.keyFor(local.jkt)).toMatchObject({ store: "local", jkt: local.jkt });
    const fresh = (await later.key())!;
    expect(fresh.store).toBe("idb"); expect(fresh.jkt).not.toBe(local.jkt);
    expect(await later.keyFor(local.jkt)).toMatchObject({ store: "local" });
    expect(await later.keyFor(fresh.jkt)).toMatchObject({ store: "idb" });
  });
  it("two tabs making the backup key at once end up with one", async () => {
    const storage = memory();
    const [a, b] = await Promise.all([backupOn(storage).key(), backupOn(storage).key()]);
    expect(a!.jkt).toBe(b!.jkt);
  });
  it("uses the Web Lock when there is one", async () => {
    const storage = memory(); const request = vi.fn((_name: string, run: () => Promise<unknown>) => run());
    const dpop = createDpop({ indexedDB: null, subtle: crypto.subtle, backupStorage: () => storage, locks: () => ({ request }) as unknown as LockManager });
    await dpop.key();
    expect(request).toHaveBeenCalledWith("wildstat:dpop-backup-key", expect.any(Function));
  });
});

describe("DPoP rollout switch", () => {
  it("is on unless this browser opted out", () => {
    expect(dpopSwitchOn(memory())).toBe(true);
    expect(dpopSwitchOn(memory({ [DPOP_SWITCH_KEY]: "on" }))).toBe(true);
    expect(dpopSwitchOn(memory({ [DPOP_SWITCH_KEY]: "off" }))).toBe(false);
    expect(dpopSwitchOn(undefined)).toBe(true);
  });
});

describe("code exchange with DPoP", () => {
  type Attempt = TokenAttempt & { result: { error?: unknown; token_type?: unknown } };
  const ok = (tokenType = "DPoP"): Attempt => ({ ok: true, result: { token_type: tokenType }, nonce: null });
  const networkFailure = (error: unknown) => error instanceof TypeError;
  it("sends no proof and touches no key while the switch is off", async () => {
    const dpop = dpopFor(); const key = vi.spyOn(dpop, "key");
    const send = vi.fn(async (_proof?: string) => ok("Bearer"));
    const exchange = await exchangeCodeWithDpop({ dpop, storage: memory({ [DPOP_SWITCH_KEY]: "off" }), endpoint: ENDPOINT, send, networkFailure });
    expect(send.mock.calls[0][0]).toBeUndefined();
    expect(key).not.toHaveBeenCalled();
    expect(exchange).toMatchObject({ label: "off" });
    expect(exchange.jkt).toBeUndefined();
  });
  it("binds the sign-in when the provider answers with a DPoP token", async () => {
    const dpop = dpopFor(); const send = vi.fn(async (_proof?: string) => ok());
    const exchange = await exchangeCodeWithDpop({ dpop, storage: memory({ [DPOP_SWITCH_KEY]: "on" }), endpoint: ENDPOINT, send, networkFailure });
    expect(await verifies(send.mock.calls[0][0]!)).toBe(true);
    expect(exchange).toMatchObject({ label: "bound:idb", store: "idb", jkt: (await dpop.key())!.jkt });
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
    const read = expect(dpop.keyFor("bound-key")).rejects.toThrow("timed out");
    const create = dpop.key();
    await vi.advanceTimersByTimeAsync(5_000);
    await read; expect(await create).toBeNull();
    vi.useRealTimers();
  });
});

describe("code exchange with a slow key store", () => {
  const stuck = { open: () => ({}) } as unknown as IDBFactory;
  const send = () => vi.fn(async (_proof?: string): Promise<TokenAttempt & { result: { token_type?: unknown } }> => ({ ok: true, result: { token_type: "DPoP" }, nonce: null }));
  it("signs in plainly once 1.75 s pass without any key, never waiting 2 s", async () => {
    vi.useFakeTimers();
    const request = send();
    const exchange = exchangeCodeWithDpop({ dpop: createDpop({ indexedDB: stuck, subtle: crypto.subtle }), storage: memory(), endpoint: ENDPOINT,
      send: request, networkFailure: () => false });
    await vi.advanceTimersByTimeAsync(1_749);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await exchange).toMatchObject({ label: "unbound", fallback: "key-slow" });
    expect(request.mock.calls[0][0]).toBeUndefined();
    vi.useRealTimers();
  });
  it("uses the localStorage backup key when IndexedDB is too slow, within 2 s", async () => {
    const storage = memory(); const request = send();
    const started = Date.now();
    const exchange = await exchangeCodeWithDpop({ dpop: createDpop({ indexedDB: stuck, subtle: crypto.subtle, backupStorage: () => storage }),
      storage, endpoint: ENDPOINT, send: request, networkFailure: () => false });
    expect(Date.now() - started).toBeLessThan(2_100);
    expect(await verifies(request.mock.calls[0][0]!)).toBe(true);
    expect(exchange).toMatchObject({ label: "bound:local", store: "local", keyNote: "idb-slow" });
  });
  it("binds to the backup key when IndexedDB is unavailable", async () => {
    const storage = memory(); const request = send();
    const exchange = await exchangeCodeWithDpop({ dpop: createDpop({ indexedDB: null, subtle: crypto.subtle, backupStorage: () => storage }),
      storage, endpoint: ENDPOINT, send: request, networkFailure: () => false });
    expect(exchange).toMatchObject({ label: "bound:local", store: "local", keyNote: "no-idb", jkt: expect.any(String) });
  });
});
