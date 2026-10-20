import { ONBOARDING_WORLD } from "../../shared/onboarding";
import type { CoopAccess } from "../game/runtime/coop-access";
import type { createGameSessionController } from "../game/runtime/game-session-controller";
import type { createMapController } from "../game/runtime/map-controller";
import type { PlayerCombatController } from "../game/runtime/player-combat-controller";
import type { PlayerController } from "../game/runtime/player-controller";
import type { createPlayerInputController } from "../game/runtime/player-input-controller";
import type { createProjectileStore } from "../game/runtime/projectile-store";
import type { EnemyState, PlayerState } from "../game/runtime/types";
import { TUTORIAL_FOREST_MAP_ID, type MapId, type SpawnSite } from "../game/world";
import { createOnboardingTutorial } from "./onboarding-tutorial";
import { installTutorialReplay, tutorialReplayBlocked } from "./tutorial-replay";

export type OnboardingRuntimeDeps = {
  coop: CoopAccess;
  player: PlayerState;
  enemies: EnemyState[];
  spawnSites: SpawnSite[];
  spawnFromSite: (site: SpawnSite) => void;
  mapController: Pick<ReturnType<typeof createMapController>, "loadMap">;
  session: ReturnType<typeof createGameSessionController>;
  resizeCanvas: () => void;
  playerController: Pick<PlayerController, "reset">;
  resetPresentation: () => void;
  projectileStore: Pick<ReturnType<typeof createProjectileStore>, "clear">;
  playerCombat: Pick<PlayerCombatController, "clearPendingThrow">;
  playerInput: Pick<ReturnType<typeof createPlayerInputController>, "clear">;
  autoFarm: { stop: () => void };
  profileWindow: { close: () => void };
  profileElement: HTMLElement;
  itemInspection: { close: () => void };
  waitForNameSave: () => Promise<void>;
  isDueling: () => boolean;
  clearLocalDeath: () => void;
  setCurrentMap: (mapId: MapId) => void;
  loadProgress: () => void;
  finishStartup: () => void;
  startGame: (markIntro?: boolean, restoreServerPosition?: boolean) => void;
  logPickup: (text: string, color: string) => void;
  showMessage: (text: string, color: string) => void;
};

/** The first-steps tutorial a new player starts in, and the Settings button that replays it. */
export function createOnboardingRuntime(deps: OnboardingRuntimeDeps) {
  const { coop, player, session } = deps;
  const client = coop.client;
  const clearInput = () => deps.playerInput.clear();

  const onboarding = createOnboardingTutorial({
    step: () => client?.onboardingStep?.() ?? 0,
    identity: coop.identity,
    connected: coop.connected,
    stats: () => ({ damage: coop.savedProgress()?.damage ?? player.damage, regen: coop.savedProgress()?.regen ?? player.regen }),
    complete: async step => client?.completeOnboardingStep?.(step),
    player, enemies: deps.enemies, sites: deps.spawnSites, spawn: deps.spawnFromSite,
    enter: mapId => {
      deps.mapController.loadMap(mapId, ONBOARDING_WORLD.spawn.x, ONBOARDING_WORLD.spawn.y);
      session.start(false, false);
      deps.resizeCanvas();
    },
    respawn: () => {
      deps.clearLocalDeath();
      deps.playerController.reset(true, true);
      deps.resetPresentation();
    },
    clearCombat: () => { deps.projectileStore.clear(); deps.playerCombat.clearPendingThrow(); },
    clearInput,
    logPickup: deps.logPickup,
    fadeToWorld: (action, duration) => session.fadeToWorld(action, duration),
    profileOpen: () => !deps.profileElement.hidden,
    setName: async name => client?.setDisplayName?.(name),
    hasChosenName: () => client?.hasChosenDisplayName?.() ?? false,
    waitForNameSave: deps.waitForNameSave,
    closeWindows: () => { deps.profileWindow.close(); deps.itemInspection.close(); },
    cancel: () => {
      deps.resizeCanvas();
      deps.profileWindow.close();
      deps.setCurrentMap(TUTORIAL_FOREST_MAP_ID);
      session.stop();
      session.setHasStarted(false);
      deps.loadProgress();
      deps.finishStartup();
    },
  });

  installTutorialReplay({
    doc: document,
    showMessage: deps.showMessage,
    blocked: () => tutorialReplayBlocked({
      running: session.isRunning(),
      inTutorial: onboarding.isActive(),
      dueling: deps.isDueling(),
      challenge: Boolean(client?.aggroChallenge?.()?.active || client?.prestigeChallenge?.()?.active),
    }),
    begin: () => {
      deps.autoFarm.stop();
      clearInput();
      onboarding.start(() => {
        deps.resizeCanvas();
        deps.setCurrentMap(TUTORIAL_FOREST_MAP_ID);
        deps.loadProgress();
        deps.startGame(false, true);
      }, true);
    },
  });

  return onboarding;
}
