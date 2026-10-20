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

/** Rollout switch: localStorage "wildstat-dpop-v1" = "on" | "off". */
export const DPOP_SWITCH_KEY = "wildstat-dpop-v1";
/** Flip to true to turn DPoP on for everyone ("off" still opts a browser out). */
const DPOP_DEFAULT_ON = false;
/** Set after DPoP failed on this browser; new sign-ins skip it until then. */
const DPOP_SUSPENDED_KEY = `${DPOP_SWITCH_KEY}:suspended-until`;
const DPOP_SUSPEND_MS = 7 * 86_400_000;

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

/** The diagnostic label for a refresh grant: bound to this device, or not and why. */
export function dpopLabel(bound: boolean, storage: SwitchStorage | undefined) {
  return bound ? "bound" : dpopSwitchOn(storage) ? "unbound" : "off";
}

export function isDpopTokenType(value: unknown) {
  return typeof value === "string" && value.toLowerCase() === "dpop";
}

export type DpopKey = { privateKey: CryptoKey; jwk: { kty: "EC"; crv: "P-256"; x: string; y: string }; jkt: string };

const DB_NAME = "wildstat-dpop";
const STORE = "keys";
const KEY_ID = "device-v1";
/** IndexedDB can hang on some Safari builds; renewal holds the cross-tab lock meanwhile. */
const IDB_TIMEOUT_MS = 5_000;

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

function withTimeout<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("IndexedDB timed out")), IDB_TIMEOUT_MS); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * One ES256 key per browser profile, kept non-extractable in IndexedDB
 * (localStorage cannot hold a CryptoKey) and shared by every tab.
 */
export function createDpop(env: { indexedDB?: IDBFactory | null; subtle?: SubtleCrypto | null; nowMs?: () => number } = {}) {
  const idb = env.indexedDB ?? null;
  const subtle = env.subtle ?? null;
  const nowMs = env.nowMs ?? (() => tokenClockNowMs());
  let loaded: DpopKey | null = null;
  let creating: Promise<DpopKey | null> | null = null;
  /** The last DPoP-Nonce the provider sent, used on the next proof. */
  let serverNonce: string | null = null;

  async function openDb() {
    if (!idb) throw new Error("IndexedDB unavailable");
    const open = idb.open(DB_NAME, 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
    return idbRequest(open);
  }

  async function describe(pair: CryptoKeyPair): Promise<DpopKey> {
    const { x, y } = await subtle!.exportKey("jwk", pair.publicKey);
    if (!x || !y) throw new Error("DPoP public key has no coordinates");
    const jwk = { kty: "EC" as const, crv: "P-256" as const, x, y };
    // RFC 7638 thumbprint: required members in lexicographic order.
    const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
    const jkt = base64Url(new Uint8Array(await subtle!.digest("SHA-256", new TextEncoder().encode(canonical))));
    return { privateKey: pair.privateKey, jwk, jkt };
  }

  /** The stored key pair, or null when there is none. Throws when it cannot be read. */
  function read() { return withTimeout(readStored()); }
  async function readStored(): Promise<CryptoKeyPair | null> {
    const db = await openDb();
    try {
      const value = await idbRequest(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY_ID));
      return value && (value as CryptoKeyPair).privateKey && (value as CryptoKeyPair).publicKey ? value as CryptoKeyPair : null;
    } finally { db.close(); }
  }

  /** Keeps the first key any tab stored: the read and write share one readwrite transaction. */
  function storeFirst(candidate: CryptoKeyPair) { return withTimeout(writeFirst(candidate)); }
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

  /**
   * This browser's key. With create, makes one if there is none (null when this
   * browser cannot: no WebCrypto or IndexedDB). Without, null means it is gone.
   * Throws when the stored key cannot be read right now.
   */
  async function key(create: boolean): Promise<DpopKey | null> {
    if (loaded) return loaded;
    if (!subtle || !idb) { if (create) return null; throw new Error("DPoP key storage unavailable"); }
    if (!create) {
      const pair = await read();
      if (pair) loaded = await describe(pair);
      return loaded;
    }
    creating ??= (async () => {
      try {
        let pair = await read();
        if (!pair) {
          const candidate = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]) as CryptoKeyPair;
          pair = await storeFirst(candidate);
        }
        loaded = await describe(pair);
        return loaded;
      } catch { return null; } finally { creating = null; }
    })();
    return creating;
  }

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

  return { key, proof, rememberNonce, nonce: () => serverNonce };
}
export type DeviceDpop = ReturnType<typeof createDpop>;

let device: DeviceDpop | null = null;
/** The browser's own DPoP key, created on first use. */
export function deviceDpop(): DeviceDpop {
  device ??= createDpop({
    indexedDB: (() => { try { return globalThis.indexedDB ?? null; } catch { return null; } })(),
    subtle: globalThis.crypto?.subtle ?? null,
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

export type DpopExchange<A> = { attempt: A; label: "bound" | "unbound" | "off"; jkt?: string; fallback?: string };

/**
 * The authorization-code exchange, with a proof when this browser wants DPoP.
 * Whatever goes wrong with DPoP, the exchange is tried once more without it:
 * a player is never kept out by it. A refused proof, or a request that only
 * fails with the DPoP header on it, turns DPoP off here for a week.
 */
export async function exchangeCodeWithDpop<A extends TokenAttempt & { result: { token_type?: unknown } }>(options: {
  dpop: DeviceDpop; storage: Pick<Storage, "getItem" | "setItem"> | undefined; endpoint: string;
  send: (proof?: string) => Promise<A>; networkFailure: (error: unknown) => boolean;
}): Promise<DpopExchange<A>> {
  const { dpop, storage, endpoint, send } = options;
  if (!dpopWanted(storage)) return { attempt: await send(), label: dpopLabel(false, storage) };
  const dpopKey = await dpop.key(true);
  let fallback = "no-key";
  if (dpopKey) {
    try {
      const attempt = await sendWithDpop(dpop, dpopKey, endpoint, send);
      if (!dpopProofRefused(attempt)) {
        const bound = attempt.ok && isDpopTokenType(attempt.result.token_type);
        return { attempt, label: bound ? "bound" : "unbound", ...(bound ? { jkt: dpopKey.jkt } : {}) };
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
  return { attempt, label: "unbound", fallback };
}
