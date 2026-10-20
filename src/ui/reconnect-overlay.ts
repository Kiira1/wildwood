import { reloadAtVersion } from "../app/version";
import { hasApprovedGameSession } from "../coop/startup-state-machine";
import type { CoopAccess } from "../game/runtime/coop-access";
import type { createGameElements } from "./game-elements";
import { createReconnectRecovery } from "./reconnect-recovery";

/** What Auto Farm may do with the connection: farm, wait for it to come back, or stop. */
export type FarmConnection = "ready" | "recovering" | "ended";

export type ReconnectOverlayDeps = {
  coop: CoopAccess;
  e: Pick<ReturnType<typeof createGameElements>, "reconnectOverlayEl" | "reconnectDetailEl" | "reconnectRetryBtn">;
  version: string;
  hasStarted: () => boolean;
  setFarmConnection: (connection: FarmConnection) => void;
  refreshAutoFarm: () => void;
  setGameplayPause: (reason: string, active: boolean) => void;
};

/**
 * The reconnect overlay and its retry button, which becomes a reload when recovery takes too long.
 * Each refresh also tells Auto Farm the connection's state and pauses play while it is down.
 */
export function createReconnectOverlay(deps: ReconnectOverlayDeps) {
  const { coop } = deps;
  const client = coop.client;
  const { reconnectOverlayEl, reconnectDetailEl, reconnectRetryBtn } = deps.e;

  const recovery = createReconnectRecovery({
    now: () => performance.now(),
    retry: () => { client?.retryConnection?.(); },
    reload: () => {
      // Never reload into account choice unless the active session handoff was saved.
      if (!client?.prepareUpdateReload?.(deps.version)) return false;
      reloadAtVersion(deps.version);
      return true;
    },
  });

  function refresh() {
    const reconnecting = Boolean(client?.isReconnectingAfterWake?.());
    const account = coop.accountState();
    const waitingForServer = Boolean(account?.updating);
    const accountRecoveryRequired = deps.hasStarted() && !hasApprovedGameSession(account);
    // Reuse connection notifications instead of reading account/token storage
    // from autofarm's per-frame movement loop.
    deps.setFarmConnection(account?.sessionConflict ? "ended"
      : reconnecting || waitingForServer || account?.authInProgress || account?.returningFromSignIn || !deps.hasStarted() ? "recovering"
      : !hasApprovedGameSession(account) ? "ended"
      : !coop.connected() || !account?.hydrated ? "recovering" : "ready");
    deps.refreshAutoFarm();
    const diagnostics = client?.connectionDiagnostics?.();
    const showReconnectOverlay = reconnecting && !waitingForServer && !accountRecoveryRequired;
    reconnectOverlayEl.hidden = !showReconnectOverlay;
    reconnectOverlayEl.classList.toggle("is-quiet", Boolean(client?.isReconnectingQuietly?.())); // a badge, not the overlay
    const extended = recovery.update(showReconnectOverlay);
    reconnectRetryBtn.textContent = extended ? "RELOAD GAME" : "RETRY NOW";
    reconnectDetailEl.textContent = extended ? "Taking longer than usual. Reload to restore your session."
      : diagnostics?.phase === "connecting"
      ? "Connecting to WildStat…"
      : diagnostics?.phase === "preparing-session"
        ? "Restoring your session…"
        : diagnostics?.phase === "hydrating"
          ? "Syncing the world…"
          : diagnostics?.issue?.message || "Restoring your connection";
    reconnectRetryBtn.hidden = !showReconnectOverlay;
    reconnectRetryBtn.disabled = false;
    // Pause reasons compose: ending an ad, reward window, or reconnect cannot
    // accidentally resume gameplay while another blocking surface remains.
    deps.setGameplayPause("connection-gate", reconnecting || waitingForServer || accountRecoveryRequired);
  }

  reconnectRetryBtn.addEventListener("click", () => {
    reconnectRetryBtn.disabled = true;
    reconnectDetailEl.textContent = "Retrying connection now…";
    recovery.activate();
  });

  return { refresh };
}
