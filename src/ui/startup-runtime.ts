import { installCanvasPurgeRecovery } from "../app/canvas-purge-recovery";
import { enforceLatestVersion, reloadAtVersion } from "../app/version";
import type { CoopAccess } from "../game/runtime/coop-access";
import { createScheduledUpdateController, createScheduledUpdateView } from "./scheduled-update-controller";
import { createStartupController } from "./startup-controller";
import { createStartupCoordinator } from "./startup-coordinator";

export type StartupCoordinator = ReturnType<typeof createStartupCoordinator>;

export type StartupScreenDeps = {
  coop: CoopAccess;
  /** The loading rows, read top to bottom each time the screen refreshes. */
  progressLoaded: () => boolean;
  playerSpriteReady: () => boolean;
  worldArtReady: () => boolean;
  currentMapReady: () => boolean;
  finishStartup: () => void;
  showUpdateNotice: () => void;
  startGame: (markIntro?: boolean) => void;
  /** The coordinator once it exists; account actions report to it. */
  coordinator: () => StartupCoordinator | undefined;
  showMessage: (text: string, color?: string) => void;
};

/** The start screen: loading rows, the account choice and legal gate, and the new player's first step. */
export function createStartupScreen(deps: StartupScreenDeps) {
  const { coop } = deps;
  const client = coop.client;
  let pageLoadComplete = document.readyState === "complete";

  const startup = createStartupController({
    accountState: coop.accountState,
    connected: coop.connected,
    knownCharacter: () => client?.knownCharacter?.() ?? "",
    knownCharacterGender: () => client?.knownCharacterGender?.() ?? 0,
    defaultPlayerName: () => coop.localDisplayName() ?? "WANDERER",
    getLoadingStages: () => [
      // The shell's bar covers game.js up to about 38%; these carry it on from there.
      ["Loading Connection", coop.connected(), 50],
      ["Loading Player Profile", Boolean(coop.localState()), 60],
      ["Loading Saved Progress", deps.progressLoaded(), 68],
      ["Loading Player Appearance", deps.playerSpriteReady(), 76],
      ["Loading Core Artwork", deps.worldArtReady(), 85],
      ["Loading Current Map", deps.currentMapReady(), 93],
      ["Loading Page Artwork", pageLoadComplete, 98],
      ["Starting WildStat", true, 100],
    ],
    onLoadingComplete: deps.finishStartup,
    onShowAccountChoice: deps.showUpdateNotice,
    acceptLegalTerms: () => client?.acceptLegalTerms?.(), ageBlocked: () => client?.ageBlocked?.() === true,
    onLegalAccepted: deps.finishStartup,
    onContinueGuest: () => client?.continueAsGuest?.(),
    onBeginAdventure: name => {
      if (name !== (coop.localDisplayName() || "")) client?.setDisplayName?.(name);
      deps.startGame(true);
    },
    signIn: () => client?.signIn?.(), switchAccount: () => client?.switchAccount?.(),
    takeOverSession: () => client?.takeOverSession?.(),
    onAccountActionStarted: (action, detail) => deps.coordinator()?.beginAccountAction(action, detail),
    onAccountActionCompleted: () => deps.coordinator()?.completeAccountAction(),
    onAccountActionFailed: detail => deps.coordinator()?.failAccountAction(detail),
    onRetryConnection: () => { deps.coordinator()?.retryConnection(); },
    showMessage: deps.showMessage,
  });

  if (!pageLoadComplete) {
    window.addEventListener("load", () => {
      pageLoadComplete = true;
      startup.refreshLoading();
      deps.finishStartup();
    }, { once: true });
  }

  return { startup, pageLoaded: () => pageLoadComplete };
}

export type StartupCoordinationDeps = {
  coop: CoopAccess;
  version: string;
  gameUpdateGate: HTMLElement;
  canvas: HTMLCanvasElement;
  screen: ReturnType<typeof createStartupScreen>;
  session: { hasStarted: () => boolean; isRunning: () => boolean };
  progress: { isLoaded: () => boolean; startupKind: () => "new" | "returning" | null };
  playerSpriteReady: () => boolean;
  worldArtReady: () => boolean;
  setGameplayPause: (reason: string, active: boolean) => void;
  /** Saves progress and the player's position before an update reloads the page. */
  saveBeforeUpdate: () => void;
  /** Hides the player from others while the update screen is up. */
  suspendPlayerVisibility: () => void;
  showNewPlayerIntro: () => void;
  startGame: () => void;
};

/**
 * Scheduled updates, the canvas-purge reload, and the coordinator that moves
 * startup from connecting through the account choice into the game.
 */
export function createStartupCoordination(deps: StartupCoordinationDeps) {
  const { coop, version, session } = deps;
  const { startup } = deps.screen;
  const client = coop.client;

  const scheduledUpdate = createScheduledUpdateController({
    now: () => Date.now(), release: () => client?.releaseWindow?.() ?? null, version,
    forcedUpdateRequired: () => client?.accountState?.().updating === true,
    playing: () => session.hasStarted(), pause: paused => deps.setGameplayPause("scheduled-update", paused),
    save: deps.saveBeforeUpdate,
    drain: async () => await client?.drainForUpdate?.() ?? true,
    acknowledge: async id => { await client?.acknowledgeRelease?.(id); },
    rememberSession: latestVersion => client?.prepareUpdateReload?.(latestVersion) ?? false,
    render: createScheduledUpdateView(),
    checkVersion: () => enforceLatestVersion(version, latestVersion => {
      deps.suspendPlayerVisibility();
      coordinator.showGameUpdating(latestVersion);
    }, updateHandoff),
  });
  const updateHandoff = { canReload: scheduledUpdate.canReload, beforeReload: scheduledUpdate.prepareReload };
  installCanvasPurgeRecovery({
    watch: [deps.canvas],
    reload: async () => {
      if (!await updateHandoff.beforeReload(version)) return false;
      reloadAtVersion(version);
      return true;
    },
  });
  window.setInterval(scheduledUpdate.tick, 250);
  document.addEventListener("visibilitychange", scheduledUpdate.tick);

  const coordinator = createStartupCoordinator({
    updateHandoff,
    version,
    gameUpdateGate: deps.gameUpdateGate,
    accountState: coop.accountState,
    pageLoadComplete: deps.screen.pageLoaded,
    playerSpriteReady: deps.playerSpriteReady,
    worldArtReady: deps.worldArtReady,
    refreshLoading: startup.refreshLoading,
    restartLoading: startup.showConnecting,
    showSessionConflict: startup.showSessionConflict,
    legalConsentAccepted: () => client?.legalConsentAccepted?.() === true,
    showLegalGate: startup.showLegalGate,
    showAccountChoice: startup.showAccountChoice,
    showAccountAction: startup.showAccountAction,
    showConnectionFailure: startup.showConnectionFailure,
    showLoading: startup.showLoading,
    showNewPlayerIntro: deps.showNewPlayerIntro,
    hideStart: startup.hideStart,
    isLoadingSequenceComplete: startup.isLoadingSequenceComplete,
    hasStarted: session.hasStarted,
    isRunning: session.isRunning,
    connected: coop.connected,
    progressLoaded: deps.progress.isLoaded,
    hasLocalState: () => Boolean(coop.localState()),
    localProfileReady: () => Boolean(client?.localProfileReady?.()),
    startupKind: deps.progress.startupKind,
    beginAdventure: () => { client?.beginAdventure?.(); },
    startGame: deps.startGame,
    retryConnection: refusedSession => client?.retryConnection?.(refusedSession),
    prepareUpdateReload: latestVersion => client?.prepareUpdateReload?.(latestVersion) ?? false,
  });

  return coordinator;
}
