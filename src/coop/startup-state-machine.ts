export type StartupMachineMode = "auth-shell" | "game-runtime";

export type StartupAccountSnapshot = {
  signedIn?: boolean;
  guestSessionApproved?: boolean;
  gameSessionApproved?: boolean;
  authInProgress?: boolean;
  returningFromSignIn?: boolean;
  sessionConflict?: boolean;
  /** The account restore has not finished, so whether to start a guest is not known yet. */
  restoring?: boolean;
  /** A visitor with no account, no sign-in under way and no sign-out just now: starts as a guest. */
  guestByDefault?: boolean;
};

export type StartupSnapshot = {
  account?: StartupAccountSnapshot;
  connectionIssue?: { message: string } | null;
  legalAccepted: boolean;
  shellReady: boolean;
  runtimeReady?: boolean;
  started?: boolean;
  startupKind?: "new" | "returning" | null;
};

export type StartupState =
  | { value: "loading-shell" }
  | { value: "account-choice"; detail: string }
  | { value: "account-action"; action: "sign-in" | "guest" | "takeover"; detail: string }
  | { value: "guest-start" }
  | { value: "verifying-sign-in" }
  | { value: "legal-consent" }
  | { value: "loading-game"; status: "ready" | "loading" }
  | { value: "loading-runtime" }
  | { value: "connection-failed"; message: string }
  | { value: "session-conflict" }
  | { value: "new-player" }
  | { value: "entering-game" }
  | { value: "running" }
  | { value: "updating"; version: string }
  | { value: "failed"; operation: "game-load"; message: string }
  | { value: "disposed" };

export type StartupEvent =
  | { type: "sync"; snapshot: StartupSnapshot }
  | { type: "begin-account-action"; action: "sign-in" | "guest" | "takeover"; detail: string }
  | { type: "complete-account-action" }
  | { type: "fail-account-action"; detail: string }
  | { type: "begin-game-load" }
  | { type: "fail-game-load"; message: string }
  | { type: "retry-connection" }
  | { type: "restart" }
  | { type: "update-detected"; version?: string }
  | { type: "update-cleared" }
  | { type: "dispose" };

export type StartupTransition = {
  previous: StartupState;
  state: StartupState;
  changed: boolean;
};

export function hasApprovedGameSession(account: StartupAccountSnapshot | undefined) {
  return Boolean(account?.signedIn || account?.guestSessionApproved || account?.gameSessionApproved);
}

function stateKey(state: StartupState) {
  switch (state.value) {
    case "account-choice": return `${state.value}:${state.detail}`;
    case "account-action": return `${state.value}:${state.action}:${state.detail}`;
    case "loading-game": return `${state.value}:${state.status}`;
    case "connection-failed": return `${state.value}:${state.message}`;
    case "updating": return `${state.value}:${state.version}`;
    case "failed": return `${state.value}:${state.operation}:${state.message}`;
    default: return state.value;
  }
}

export function deriveStartupState(mode: StartupMachineMode, snapshot: StartupSnapshot): StartupState {
  const account = snapshot.account;
  if (account?.sessionConflict) return { value: "session-conflict" };
  if (!hasApprovedGameSession(account)) {
    if (account?.authInProgress || account?.returningFromSignIn) return { value: "verifying-sign-in" };
    if (!snapshot.shellReady) return { value: "loading-shell" };
    // Only the shell starts a guest by itself: consent first, then the guest is created.
    if (mode === "auth-shell" && account?.restoring) return { value: "loading-shell" };
    if (mode === "auth-shell" && account?.guestByDefault) {
      return snapshot.legalAccepted ? { value: "guest-start" } : { value: "legal-consent" };
    }
    return { value: "account-choice", detail: "" };
  }
  if (snapshot.started) return { value: "running" };
  if (!snapshot.legalAccepted) {
    return snapshot.shellReady ? { value: "legal-consent" } : { value: "loading-shell" };
  }
  if (mode === "auth-shell") return { value: "loading-game", status: "ready" };
  if (snapshot.connectionIssue) {
    return { value: "connection-failed", message: snapshot.connectionIssue.message };
  }
  if (!snapshot.runtimeReady) return { value: "loading-runtime" };
  if (snapshot.startupKind === "new") return { value: "new-player" };
  if (snapshot.startupKind === "returning") return { value: "entering-game" };
  return { value: "loading-runtime" };
}

/** Guest from the choice or the automatic guest start; Sign In from the choice or the consent step. */
function actionAllowed(state: StartupState, action: "sign-in" | "guest" | "takeover") {
  if (action === "takeover") return state.value === "session-conflict";
  if (state.value === "account-choice") return true;
  return action === "guest" ? state.value === "guest-start" : state.value === "legal-consent";
}

/**
 * Owns legal startup transitions and makes transient operations explicit.
 * External systems report one immutable snapshot; UI controllers render only
 * the resulting state instead of independently interpreting flag combinations.
 */
export function createStartupStateMachine(mode: StartupMachineMode) {
  let state: StartupState = { value: "loading-shell" };
  let lastSnapshot: StartupSnapshot | null = null;
  /** After an automatic guest start fails, the page offers the choice instead of retrying it. */
  let guestStartFailed = false;

  function derive(snapshot: StartupSnapshot): StartupState {
    const derived = deriveStartupState(mode, snapshot);
    return derived.value === "guest-start" && guestStartFailed ? { value: "account-choice", detail: "" } : derived;
  }

  function commit(next: StartupState): StartupTransition {
    const previous = state;
    state = next;
    return { previous, state, changed: stateKey(previous) !== stateKey(next) };
  }

  function sync(snapshot: StartupSnapshot) {
    lastSnapshot = snapshot;
    const derived = derive(snapshot);
    if (state.value === "failed" || state.value === "updating" || state.value === "disposed") {
      return commit(state);
    }
    if (
      derived.value === "session-conflict" &&
      !(state.value === "account-action" && state.action === "takeover")
    ) return commit(derived);
    if (derived.value === "verifying-sign-in") return commit(derived);
    if (
      state.value === "account-action"
      || state.value === "loading-game" && state.status === "loading"
    ) {
      return commit(state);
    }
    return commit(derived);
  }

  function dispatch(event: Exclude<StartupEvent, { type: "sync" }>): StartupTransition {
    if (state.value === "disposed") return commit(state);
    switch (event.type) {
      case "begin-account-action":
        if (!actionAllowed(state, event.action)) return commit(state);
        return commit({ value: "account-action", action: event.action, detail: event.detail });
      case "complete-account-action":
        if (state.value !== "account-action") return commit(state);
        return lastSnapshot ? commit(derive(lastSnapshot)) : commit({ value: "loading-shell" });
      case "fail-account-action":
        if (state.value !== "account-action") return commit(state);
        if (state.action === "guest") guestStartFailed = true;
        if (!lastSnapshot) return commit({ value: "account-choice", detail: event.detail });
        {
          const derived = derive(lastSnapshot);
          return commit(derived.value === "account-choice"
            ? { value: "account-choice", detail: event.detail }
            : derived);
        }
      case "begin-game-load":
        if (state.value !== "session-conflict" && (state.value !== "loading-game" || state.status !== "ready")) return commit(state);
        return commit({ value: "loading-game", status: "loading" });
      case "fail-game-load":
        if (state.value !== "loading-game" || state.status !== "loading") return commit(state);
        return commit({ value: "failed", operation: "game-load", message: event.message });
      case "retry-connection":
        if (state.value !== "connection-failed") return commit(state);
        return commit({ value: "loading-runtime" });
      case "restart":
        if (state.value === "failed" || state.value === "updating") return commit(state);
        return commit({ value: mode === "auth-shell" ? "loading-shell" : "loading-runtime" });
      case "update-detected":
        return commit({ value: "updating", version: event.version ?? "" });
      case "update-cleared":
        // Only a refusal with no newer build behind it; a real update reloads.
        if (state.value !== "updating" || state.version) return commit(state);
        return lastSnapshot ? commit(derive(lastSnapshot)) : commit({ value: "loading-shell" });
      case "dispose":
        return commit({ value: "disposed" });
    }
  }

  return {
    dispatch,
    state: () => state,
    sync,
  };
}
