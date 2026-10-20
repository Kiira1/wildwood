import { SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../../shared/rules";
import { inspectSpacetimeIdToken, verifySpacetimeIdToken } from "../security/oidc-id-token";
import { accountRenewalStartedAt, markAccountRenewal } from "../../app/account-renewal-flag";
import { deviceDpop, dpopLabel, dpopProofRefused, sendWithDpop, suspendDpop, type DeviceDpop, type DpopKey, type DpopStore, type TokenAttempt } from "./account-dpop";

export class AccountRenewalRequired extends Error {
  /** no-grant: nothing to refresh with. grant-rejected: the provider refused it. `detail` says why, for diagnostics. */
  constructor(readonly reason: "no-grant" | "grant-rejected", readonly detail = "") { super("Account sign-in renewal required"); }
}

/**
 * Renew ahead once this share of the ID token's life has passed since it was
 * received, and never sooner than ten minutes after. A tab that keeps its
 * token current never needs a renewal when it reloads or reconnects, which is
 * exactly when a page can go away mid-request and cost the player their
 * sign-in. Measured from local receipt time, not the provider's `exp` against
 * the device clock, so a clock running fast cannot make it renew every tick.
 */
export const RENEW_AHEAD_ELAPSED_FRACTION = 0.75;
export const RENEW_AHEAD_MIN_INTERVAL_SECONDS = 600;

/** How long a connection waits for renewal before retrying. The request itself
 * runs on: the provider replaces the refresh token as it answers, so dropping
 * that answer leaves only a spent token, and presenting a spent token revokes
 * the whole sign-in. */
const RENEWAL_WAIT_MS = 15_000;
const RENEWAL_REQUEST_LIMIT_MS = 120_000;

/** Keeps refresh credentials tied to the original account, including across tabs.
 * Expired claims are read only for account matching, never accepted for a socket. */
export function createAccountTokenRenewal(storage: Storage, key: string, tabStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  options: { dpop?: () => DeviceDpop; report?: (detail: string) => void } = {}) {
  const refreshKey = `${key}:refresh`;
  const dpop = options.dpop ?? deviceDpop;
  let pending: Promise<string> | null = null;
  // Nothing has renewed on this page yet, so a flag already set is the
  // previous page in this tab going away mid-request: its rotated grant is
  // lost, and the next refresh will be refused. Reported with that refusal.
  let interruptedBefore = accountRenewalStartedAt(tabStorage) !== null;
  if (interruptedBefore) markAccountRenewal(false, tabStorage);
  function stored() {
    try {
      const token = storage.getItem(key);
      if (token) { inspectSpacetimeIdToken(token, { allowExpired: true }); return token; }
    } catch {
      try { storage.removeItem(key); clear(); } catch {}
    }
    return null;
  }
  function clear() { storage.removeItem(refreshKey); }
  /** chainAt: when the sign-in that started this run of refresh tokens came back.
   * jkt: the device key the refresh token is bound to (DPoP), held in dpopStore; chainDays: the last whole day of the chain reported. */
  type Grant = { subject?: string; token?: string; nonce?: string; savedAt?: number; chainAt?: number; jkt?: string; dpopStore?: DpopStore; chainDays?: number };
  function grantFor(subject: string): Grant | null {
    let grant: Grant = {};
    try { grant = JSON.parse(storage.getItem(refreshKey) || "{}"); } catch {}
    return grant.subject === subject && grant.token ? grant : null;
  }
  /** A sign-in starts a new chain (chainAt now); a renewal passes the chain's start on, or null when unknown. */
  function save(token: string, refresh: unknown, saved: { nonce?: string; chainAt?: number | null; jkt?: string; dpopStore?: DpopStore; chainDays?: number } = {}) {
    const claims = inspectSpacetimeIdToken(token);
    const chainAt = saved.chainAt === undefined ? Date.now() : saved.chainAt;
    // Write the refresh grant before exposing the new ID token to other tabs.
    if (typeof refresh === "string" && refresh) storage.setItem(refreshKey, JSON.stringify({ subject: claims.sub, token: refresh,
      nonce: claims.nonce ?? saved.nonce, savedAt: Date.now(), ...(chainAt === null ? {} : { chainAt }),
      ...(saved.jkt ? { jkt: saved.jkt, dpopStore: saved.dpopStore ?? "idb" } : {}), ...(saved.chainDays ? { chainDays: saved.chainDays } : {}) }));
    else clear();
    storage.setItem(key, token);
  }
  async function resolve(original: string, force = false): Promise<string> {
    const subject = inspectSpacetimeIdToken(original, { allowExpired: true }).sub;
    const latest = stored();
    if (!latest || inspectSpacetimeIdToken(latest, { allowExpired: true }).sub !== subject) throw new Error("Account changed during connection");
    try {
      inspectSpacetimeIdToken(latest);
      if (!force || latest !== original) return latest;
    } catch {}
    if (pending) return waitFor(pending);
    const renew = async () => {
      // Web Locks serialize refresh-token rotation across same-origin tabs.
      const before = stored();
      if (!before || inspectSpacetimeIdToken(before, { allowExpired: true }).sub !== subject) throw new Error("Account changed during renewal");
      if (before !== latest) { inspectSpacetimeIdToken(before); return before; }
      const grant = grantFor(subject);
      if (!grant?.token) throw new AccountRenewalRequired("no-grant");
      const hours = (ms: number) => `${(ms / 3_600_000).toFixed(1)}h`;
      const label = dpopLabel(grant.jkt ? grant.dpopStore ?? "idb" : null, storage);
      const refused = (desc: unknown) => {
        const { iat, auth_time: authTime } = inspectSpacetimeIdToken(before, { allowExpired: true });
        // grant-age resets with every rotation; auth-age (since the player
        // last signed in at SpacetimeAuth) is what shows a cap on the whole grant.
        return new AccountRenewalRequired("grant-rejected", [
          `grant-age=${typeof grant.savedAt === "number" ? hours(Date.now() - grant.savedAt) : "unknown"}`,
          // Time since the sign-in this chain of refresh tokens came from.
          `chain-age=${typeof grant.chainAt === "number" ? hours(Date.now() - grant.chainAt) : "unknown"}`,
          `token-age=${hours(Date.now() - iat * 1000)}`,
          `auth-age=${typeof authTime === "number" ? hours(Date.now() - authTime * 1000) : "unknown"}`,
          `interrupted=${interruptedBefore ? "yes" : "no"}`,
          `dpop=${label}`,
          `desc=${String(desc ?? "none").slice(0, 80)}`,
        ].join(";"));
      };
      // A bound refresh token only works with the key it was bound to, from
      // whichever store holds it, so it is always sent with that key's proof.
      let dpopKey: DpopKey | null = null;
      if (grant.jkt) {
        try { dpopKey = await dpop().keyFor(grant.jkt); } catch { throw refused("dpop-key-unreadable"); }
        if (dpopKey?.jkt !== grant.jkt) {
          if (storage.getItem(key) === before) clear();
          throw refused("dpop-key-lost");
        }
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RENEWAL_REQUEST_LIMIT_MS);
      markAccountRenewal(true, tabStorage);
      try {
        const endpoint = `${SPACETIME_AUTH_ISSUER}/token`;
        const send = async (proof?: string) => {
          const response = await fetch(endpoint, {
            method: "POST", signal: controller.signal, credentials: "omit",
            headers: { "content-type": "application/x-www-form-urlencoded", ...(proof ? { DPoP: proof } : {}) },
            body: new URLSearchParams({ grant_type: "refresh_token", client_id: SPACETIME_AUTH_CLIENT_ID, refresh_token: grant.token! }),
          });
          const result = await response.json();
          return { ok: response.ok, status: response.status, result, nonce: response.headers?.get?.("DPoP-Nonce") ?? null } satisfies TokenAttempt & { status: number };
        };
        const attempt = dpopKey ? await sendWithDpop(dpop(), dpopKey, endpoint, send) : await send();
        const result = attempt.result;
        if (!attempt.ok) {
          if (result.error === "invalid_grant") {
            if (storage.getItem(key) === before) clear();
            throw refused(result.error_description);
          }
          if (dpopKey && dpopProofRefused(attempt)) {
            // The token cannot be refreshed without the proof, so this sign-in
            // ends here; the next one on this browser is not bound.
            suspendDpop(storage);
            if (storage.getItem(key) === before) clear();
            throw refused(`dpop-${result.error}:${String(result.error_description ?? "none")}`);
          }
          throw new Error(`Account renewal temporarily unavailable (HTTP ${attempt.status})`);
        }
        // The provider has already spent the old refresh token. Keep the new
        // one before anything else can fail (verifying fetches the signing
        // keys over the network): discarding it left only the spent token,
        // and presenting that revokes the whole sign-in.
        if (typeof result.refresh_token === "string" && result.refresh_token && storage.getItem(key) === before) {
          storage.setItem(refreshKey, JSON.stringify({ ...grant, token: result.refresh_token }));
        }
        if (typeof result.id_token !== "string") throw new Error("Account renewal returned no ID token");
        const claims = await verifySpacetimeIdToken(result.id_token, {});
        const previousClaims = inspectSpacetimeIdToken(before, { allowExpired: true });
        const expectedNonce = grant.nonce ?? previousClaims.nonce;
        if (claims.sub !== subject || (claims.nonce !== undefined && claims.nonce !== expectedNonce)) throw new Error("Account changed during renewal");
        if (storage.getItem(key) !== before) throw new Error("Account changed during renewal");
        // Once a day of the chain, so diagnostics show whether a chain outlives 24 hours.
        const chainDays = typeof grant.chainAt === "number" ? Math.floor((Date.now() - grant.chainAt) / 86_400_000) : 0;
        save(result.id_token, result.refresh_token ?? grant.token, { nonce: expectedNonce, chainAt: grant.chainAt ?? null, jkt: grant.jkt, dpopStore: grant.dpopStore,
          chainDays: Math.max(chainDays, grant.chainDays ?? 0) });
        if (chainDays > (grant.chainDays ?? 0)) {
          options.report?.(`renewal-chain:days=${chainDays};chain-age=${hours(Date.now() - grant.chainAt!)};dpop=${label}`);
        }
        interruptedBefore = false;
        return result.id_token;
      } finally { clearTimeout(timeout); markAccountRenewal(false, tabStorage); }
    };
    pending = (globalThis.navigator?.locks
      ? navigator.locks.request(`wildstat:${key}:renew`, renew)
      : renew()).finally(() => { pending = null; });
    return waitFor(pending);
  }
  function waitFor(request: Promise<string>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Account renewal timed out")), RENEWAL_WAIT_MS);
    });
    return Promise.race([request, deadline]).finally(() => clearTimeout(timer));
  }
  /**
   * Renews the stored token once most of its life has passed, and otherwise
   * does nothing (null). Shares the one request and lock with connection
   * renewals. A sign-in with no refresh grant (a forced login returns none)
   * has nothing to renew with and is left to the next connection, as before.
   */
  async function renewAhead(nowMs = Date.now()): Promise<string | null> {
    const latest = stored();
    if (!latest) return null;
    const claims = inspectSpacetimeIdToken(latest, { allowExpired: true });
    const grant = grantFor(claims.sub);
    if (!grant) return null;
    const lifetime = Math.max(0, claims.exp - claims.iat);
    const dueAfter = Math.max(RENEW_AHEAD_MIN_INTERVAL_SECONDS, lifetime * RENEW_AHEAD_ELAPSED_FRACTION);
    // Grants saved before savedAt existed fall back to the token's own clock, once.
    const elapsed = typeof grant.savedAt === "number" ? (nowMs - grant.savedAt) / 1000 : nowMs / 1000 - claims.iat;
    if (elapsed < dueAfter) return null;
    return resolve(latest, true);
  }
  return { stored, save, clear, resolve, renewAhead };
}
