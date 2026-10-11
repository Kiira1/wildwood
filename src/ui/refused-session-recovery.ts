import { STALE_SESSION_RELOAD_AFTER_MS } from "../app/version";

/** Wait between fresh connections after the first: 10 s, 20 s, 40 s, then once a minute. */
export const REFUSED_SESSION_RETRY_BASE_MS = 10_000;
export const REFUSED_SESSION_RETRY_MAX_MS = 60_000;
/** Fresh connections refused in a row before the page itself is reloaded instead. */
export const REFUSED_SESSION_RECONNECTS_BEFORE_RELOAD = 3;

/**
 * The server answers a connection it holds no session for (lost to a database
 * restart or a sweep) exactly as it answers an outdated client: "updated,
 * refresh". Once version.json has shown no newer build for the grace a deploy
 * needs, this build is current and only its session is gone, so open a fresh
 * connection, which the server gives a fresh session. A client that really is
 * outdated is refused again; after a few refusals, backing off, it reloads the
 * page instead (and reloadStaleSession allows that once per cooldown). The
 * count resets only on a healthy connection, so no server answer can loop it.
 */
export function createRefusedSessionRecovery(d: {
  now: () => number;
  /** Clears the refusal and opens a fresh connection; false when it cannot now (a hidden tab). */
  reconnect: () => boolean;
  /** Reloads after the save handoff; false when it may not (cooldown, handoff refused). */
  reload: (blockedForMs: number) => boolean;
}) {
  let blockedSince = 0, nextTryAt = 0, reconnects = 0;
  return {
    tick(updating: boolean, connected: boolean) {
      const now = d.now();
      if (!updating) {
        if (connected) blockedSince = nextTryAt = reconnects = 0;
        return;
      }
      if (!blockedSince) { blockedSince = now; nextTryAt = now + STALE_SESSION_RELOAD_AFTER_MS; }
      if (now < nextTryAt) return;
      if (reconnects < REFUSED_SESSION_RECONNECTS_BEFORE_RELOAD && d.reconnect()) {
        reconnects += 1;
        nextTryAt = now + Math.min(REFUSED_SESSION_RETRY_MAX_MS, REFUSED_SESSION_RETRY_BASE_MS * 2 ** (reconnects - 1));
        return;
      }
      if (d.reload(now - blockedSince)) { nextTryAt = now + REFUSED_SESSION_RETRY_MAX_MS; return; }
      // Reload not allowed yet: keep trying fresh connections, once a minute.
      if (d.reconnect()) nextTryAt = now + REFUSED_SESSION_RETRY_MAX_MS;
    },
  };
}
