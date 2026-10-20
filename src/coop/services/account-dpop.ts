import { tokenClockNowMs } from "../security/token-clock";

/**
 * DPoP (RFC 9449) for SpacetimeAuth token requests.
 *
 * SpacetimeAuth refuses a public client's refresh token 24 hours after sign-in,
 * however often it was rotated. A refresh token bound to a device key (DPoP)
 * gets a fresh lifetime on each rotation instead. Binding happens at the code
 * exchange; a bound refresh token can then only be refreshed with the same key.
 * The ID token sent to SpacetimeDB is unchanged.
 */

/** Per-browser override: localStorage "wildstat-dpop-v1" = "on" | "off". */
export const DPOP_SWITCH_KEY = "wildstat-dpop-v1";
/** On for everyone; "off" in localStorage opts one browser out. */
const DPOP_DEFAULT_ON = true;
/** Set after DPoP failed on this browser; new sign-ins skip it until then. */
const DPOP_SUSPENDED_KEY = `${DPOP_SWITCH_KEY}:suspended-until`;
const DPOP_SUSPEND_MS = 7 * 86_400_000;
/** The longest a sign-in waits for the device key before its token request:
 * the IndexedDB key first, then the localStorage backup key. */
const IDB_KEY_WAIT_MS = 1_750;
const BACKUP_KEY_WAIT_MS = 250;

type SwitchStorage = Pick<Storage, "getItem">;

/** Whether this browser's switch is on, ignoring a suspension. */
export function dpopSwitchOn(storage: SwitchStorage | undefined) {
  try {
    const value = storage?.getItem(DPOP_SWITCH_KEY);
    return value === "on" || (DPOP_DEFAULT_ON && value !== "off");
  } catch { return false; }
}

/** Whether new sign-ins should bind their refresh token. */
export function dpopWanted(storage: SwitchStorage | undefined, nowMs = Date.now()) {
  if (!dpopSwitchOn(storage)) return false;
  try { return !(Number(storage?.getItem(DPOP_SUSPENDED_KEY)) > nowMs); } catch { return true; }
}

/** Stops binding new sign-ins on this browser for a week, after DPoP itself failed. */
export function suspendDpop(storage: Pick<Storage, "setItem"> | undefined, nowMs = Date.now()) {
  try { storage?.setItem(DPOP_SUSPENDED_KEY, String(nowMs + DPOP_SUSPEND_MS)); } catch {}
}

/** Where a device key lives: IndexedDB (non-extractable) or the localStorage backup. */
export type DpopStore = "idb" | "local";

/** The diagnostic label for a refresh grant: bound to which store's key, or not and why. */
export function dpopLabel(store: DpopStore | null | undefined, storage: SwitchStorage | undefined) {
  return store ? `bound:${store}` : dpopSwitchOn(storage) ? "unbound" : "off";
}

export function isDpopTokenType(value: unknown) {
  return typeof value === "string" && value.toLowerCase() === "dpop";
}

export type DpopKey = { privateKey: CryptoKey; jwk: { kty: "EC"; crv: "P-256"; x: string; y: string }; jkt: string; store: DpopStore };

const DB_NAME = "wildstat-dpop";
const STORE = "keys";
const KEY_ID = "device-v1";
/** The backup key's private JWK, used only when IndexedDB cannot keep a key. */
export const DPOP_BACKUP_KEY = "wildstat-dpop-backup-key-v1";
/** IndexedDB can hang on some Safari builds; renewal holds the cross-tab lock meanwhile. */
const IDB_TIMEOUT_MS = 5_000;
const ES256 = { name: "ECDSA", namedCurve: "P-256" } as const;

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const encodeJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

function idbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

class DpopTimeout extends Error {}
function withTimeout<T>(work: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DpopTimeout("IndexedDB timed out")), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * WebKit's first IndexedDB request after launch can hang until IndexedDB is
 * poked; polling indexedDB.databases() wakes it (the safari-14-idb-fix approach).
 */
export function wakeIndexedDB(idb: IDBFactory, maxMs = IDB_TIMEOUT_MS) {
  if (typeof idb.databases !== "function") return Promise.resolve();
  return new Promise<void>(resolve => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const done = () => { clearInterval(interval); clearTimeout(giveUp); resolve(); };
    const poke = () => { try { idb.databases().then(done, done); } catch { done(); } };
    interval = setInterval(poke, 100);
    giveUp = setTimeout(done, maxMs);
    poke();
  });
}

type BackupStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * One ES256 key per browser profile, shared by every tab: non-extractable in
 * IndexedDB (localStorage cannot hold a CryptoKey), or, where IndexedDB fails,
 * an extractable backup kept as a JWK in localStorage.
 */
export function createDpop(env: {
  indexedDB?: IDBFactory | null; subtle?: SubtleCrypto | null; nowMs?: () => number;
  backupStorage?: () => BackupStorage | undefined; locks?: () => LockManager | undefined;
} = {}) {
  const idb = env.indexedDB ?? null;
  const subtle = env.subtle ?? null;
  const nowMs = env.nowMs ?? (() => tokenClockNowMs());
  const backupStorage = () => { try { return env.backupStorage?.(); } catch { return undefined; } };
  let idbKey: DpopKey | null = null;
  let localKey: DpopKey | null = null;
  let idbCreating: Promise<DpopKey> | null = null;
  let localCreating: Promise<DpopKey | null> | null = null;
  let woken: Promise<void> | null = null;
  /** Why the last new sign-in had to use the backup key, until reported. */
  let fallbackNote: string | null = null;
  /** The last DPoP-Nonce the provider sent, used on the next proof. */
  let serverNonce: string | null = null;

  async function openDb() {
    if (!idb) throw new Error("IndexedDB unavailable");
    await (woken ??= wakeIndexedDB(idb));
    const open = idb.open(DB_NAME, 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
    return idbRequest(open);
  }

  async function describe(privateKey: CryptoKey, x: string, y: string, store: DpopStore): Promise<DpopKey> {
    const jwk = { kty: "EC" as const, crv: "P-256" as const, x, y };
    // RFC 7638 thumbprint: required members in lexicographic order.
    const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
    const jkt = base64Url(new Uint8Array(await subtle!.digest("SHA-256", new TextEncoder().encode(canonical))));
    return { privateKey, jwk, jkt, store };
  }
  async function describePair(pair: CryptoKeyPair) {
    const { x, y } = await subtle!.exportKey("jwk", pair.publicKey);
    if (!x || !y) throw new Error("DPoP public key has no coordinates");
    return describe(pair.privateKey, x, y, "idb");
  }

  /** The stored key pair, or null when there is none. Throws when it cannot be read. */
  function readIdb() { return withTimeout(readStored(), IDB_TIMEOUT_MS); }
  async function readStored(): Promise<CryptoKeyPair | null> {
    const db = await openDb();
    try {
      const value = await idbRequest(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY_ID));
      return value && (value as CryptoKeyPair).privateKey && (value as CryptoKeyPair).publicKey ? value as CryptoKeyPair : null;
    } finally { db.close(); }
  }

  /** Keeps the first key any tab stored: the read and write share one readwrite transaction. */
  function storeFirst(candidate: CryptoKeyPair) { return withTimeout(writeFirst(candidate), IDB_TIMEOUT_MS); }
  async function writeFirst(candidate: CryptoKeyPair): Promise<CryptoKeyPair> {
    const db = await openDb();
    try {
      return await new Promise<CryptoKeyPair>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        let winner = candidate;
        const get = store.get(KEY_ID);
        get.onsuccess = () => {
          const existing = get.result as CryptoKeyPair | undefined;
          if (existing?.privateKey && existing.publicKey) winner = existing;
          else store.put(candidate, KEY_ID);
        };
        tx.oncomplete = () => resolve(winner);
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
      });
    } finally { db.close(); }
  }

  /** The IndexedDB key, made once per browser; one attempt in flight per page. */
  function idbDeviceKey(): Promise<DpopKey> {
    if (idbKey) return Promise.resolve(idbKey);
    if (!subtle || !idb) return Promise.reject(new Error("IndexedDB unavailable"));
    idbCreating ??= (async () => {
      try {
        let pair = await readIdb();
        pair ??= await storeFirst(await subtle.generateKey(ES256, false, ["sign", "verify"]) as CryptoKeyPair);
        return (idbKey = await describePair(pair));
      } finally { idbCreating = null; }
    })();
    return idbCreating;
  }

  async function readBackup(): Promise<DpopKey | null> {
    if (localKey) return localKey;
    let stored: JsonWebKey | null = null;
    try { stored = JSON.parse(backupStorage()?.getItem(DPOP_BACKUP_KEY) ?? "null"); } catch {}
    if (!stored?.d || !stored.x || !stored.y || !subtle) return null;
    const privateKey = await subtle.importKey("jwk", stored, ES256, false, ["sign"]);
    return (localKey = await describe(privateKey, stored.x, stored.y, "local"));
  }

  /** The localStorage backup key, made once per browser (first stored wins across tabs). */
  function backupKey(): Promise<DpopKey | null> {
    const storage = backupStorage();
    if (!subtle || !storage) return Promise.resolve(null);
    localCreating ??= (async () => {
      const make = async () => {
        const existing = await readBackup();
        if (existing) return existing;
        const pair = await subtle.generateKey(ES256, true, ["sign", "verify"]) as CryptoKeyPair;
        const { kty, crv, d, x, y } = await subtle.exportKey("jwk", pair.privateKey);
        // Read again right before writing: another tab may have stored one meanwhile.
        if (!storage.getItem(DPOP_BACKUP_KEY)) storage.setItem(DPOP_BACKUP_KEY, JSON.stringify({ kty, crv, d, x, y }));
        return readBackup();
      };
      try {
        const locks = env.locks?.();
        return await (locks ? locks.request("wildstat:dpop-backup-key", make) : make());
      } catch { return null; } finally { localCreating = null; }
    })();
    return localCreating;
  }

  /**
   * The key a new sign-in binds to: the IndexedDB key, or the backup when
   * IndexedDB fails. Null when this browser can keep neither.
   */
  async function key(): Promise<DpopKey | null> {
    if (!subtle) return null;
    try { return await idbDeviceKey(); } catch (error) {
      const why = !idb ? "no-idb" : error instanceof DpopTimeout ? "idb-slow" : "idb-error";
      return backupFor(why);
    }
  }
  async function backupFor(why: string) {
    const backup = await backupKey();
    if (backup) fallbackNote ??= why;
    return backup;
  }

  /**
   * The key a bound grant was bound to, from whichever store holds it, or null
   * when it is gone. Throws when IndexedDB cannot be read right now.
   */
  async function keyFor(jkt: string): Promise<DpopKey | null> {
    if (idbKey?.jkt === jkt) return idbKey;
    if (!subtle) return null;
    if ((await readBackup().catch(() => null))?.jkt === jkt) return localKey;
    if (!idb) return null;
    const pair = await readIdb();
    if (pair) idbKey = await describePair(pair);
    return idbKey?.jkt === jkt ? idbKey : null;
  }

  /** Starts loading (or making) the IndexedDB key without waiting, so a sign-in finds it ready. */
  function warm() { if (subtle && idb) idbDeviceKey().catch(() => {}); }

  /** A DPoP proof for one request: htu is the endpoint without query or fragment. */
  async function proof(dpopKey: DpopKey, htm: string, endpoint: string, nonce = serverNonce) {
    const url = new URL(endpoint); url.search = ""; url.hash = "";
    const jti = new Uint8Array(16); crypto.getRandomValues(jti);
    const header = { typ: "dpop+jwt", alg: "ES256", jwk: dpopKey.jwk };
    const payload = { jti: base64Url(jti), htm, htu: url.href, iat: Math.floor(nowMs() / 1000), ...(nonce ? { nonce } : {}) };
    const input = `${encodeJson(header)}.${encodeJson(payload)}`;
    const signature = await subtle!.sign({ name: "ECDSA", hash: "SHA-256" }, dpopKey.privateKey, new TextEncoder().encode(input));
    return `${input}.${base64Url(new Uint8Array(signature))}`;
  }

  function rememberNonce(value: string | null | undefined) { if (value) serverNonce = value; }
  /** Why a sign-in fell back to the backup key, once. */
  function takeFallbackNote() { const note = fallbackNote; fallbackNote = null; return note; }

  return { key, keyFor, backupFor, warm, proof, rememberNonce, takeFallbackNote, nonce: () => serverNonce };
}
export type DeviceDpop = ReturnType<typeof createDpop>;

let device: DeviceDpop | null = null;
/** The browser's own DPoP key, created on first use. */
export function deviceDpop(): DeviceDpop {
  device ??= createDpop({
    indexedDB: (() => { try { return globalThis.indexedDB ?? null; } catch { return null; } })(),
    subtle: globalThis.crypto?.subtle ?? null,
    backupStorage: () => globalThis.localStorage,
    locks: () => globalThis.navigator?.locks,
  });
  return device;
}

/** One answer from the token endpoint; nonce is its DPoP-Nonce header when readable. */
export type TokenAttempt = { ok: boolean; result: { error?: unknown }; nonce: string | null };

/**
 * Sends a token request with a proof, and once more with the provider's nonce
 * when it asks for one (use_dpop_nonce). A rejected proof never spends the
 * code or refresh token: the provider checks the proof first.
 */
export async function sendWithDpop<A extends TokenAttempt>(dpop: DeviceDpop, dpopKey: DpopKey, endpoint: string, send: (proof: string) => Promise<A>) {
  let attempt = await send(await dpop.proof(dpopKey, "POST", endpoint));
  dpop.rememberNonce(attempt.nonce);
  if (!attempt.ok && attempt.result.error === "use_dpop_nonce" && attempt.nonce) {
    attempt = await send(await dpop.proof(dpopKey, "POST", endpoint, attempt.nonce));
    dpop.rememberNonce(attempt.nonce);
  }
  return attempt;
}

/** The provider did not accept the proof itself (as opposed to the grant). */
export function dpopProofRefused(attempt: TokenAttempt) {
  return !attempt.ok && (attempt.result.error === "invalid_dpop_proof" || attempt.result.error === "use_dpop_nonce");
}

export type DpopExchange<A> = { attempt: A; label: string; jkt?: string; store?: DpopStore; fallback?: string; keyNote?: string };

function within<T>(work: Promise<T>, ms: number): Promise<T | "slow"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<"slow">(resolve => { timer = setTimeout(() => resolve("slow"), ms); });
  return Promise.race([work, slow]).finally(() => clearTimeout(timer));
}

/**
 * The authorization-code exchange, with a proof when this browser wants DPoP.
 * It waits at most 2 s for a key (the exchange's own 15 s timeout starts
 * after). Whatever goes wrong with DPoP, the exchange is tried once more
 * without it: a player is never kept out by it. A refused proof, or a request
 * that only fails with the DPoP header on it, turns DPoP off here for a week.
 */
export async function exchangeCodeWithDpop<A extends TokenAttempt & { result: { token_type?: unknown } }>(options: {
  dpop: DeviceDpop; storage: Pick<Storage, "getItem" | "setItem"> | undefined; endpoint: string;
  send: (proof?: string) => Promise<A>; networkFailure: (error: unknown) => boolean;
}): Promise<DpopExchange<A>> {
  const { dpop, storage, endpoint, send } = options;
  if (!dpopWanted(storage)) return { attempt: await send(), label: dpopLabel(null, storage) };
  let found = await within(dpop.key().catch(() => null), IDB_KEY_WAIT_MS);
  const idbSlow = found === "slow";
  if (idbSlow) found = await within(dpop.backupFor("idb-slow"), BACKUP_KEY_WAIT_MS);
  const dpopKey = found === "slow" ? null : found;
  const keyNote = dpop.takeFallbackNote() ?? undefined;
  let fallback = idbSlow ? "key-slow" : "no-key";
  if (dpopKey) {
    try {
      const attempt = await sendWithDpop(dpop, dpopKey, endpoint, send);
      if (!dpopProofRefused(attempt)) {
        const bound = attempt.ok && isDpopTokenType(attempt.result.token_type);
        return { attempt, label: dpopLabel(bound ? dpopKey.store : null, storage), keyNote,
          ...(bound ? { jkt: dpopKey.jkt, store: dpopKey.store } : {}) };
      }
      fallback = String(attempt.result.error).slice(0, 40);
      suspendDpop(storage);
    } catch (error) {
      if (!options.networkFailure(error)) throw error;
      fallback = "network";
    }
  }
  const attempt = await send();
  // Only the DPoP request failed, so it was the header, not the network.
  if (fallback === "network" && attempt.ok) suspendDpop(storage);
  return { attempt, label: "unbound", fallback, keyNote };
}
