import { isWeaponItem } from "../../../shared/items";
import {
  DEFAULT_ATTACK_INTERVAL, PLAYER_BASE_DAMAGE, PLAYER_BASE_HP, PLAYER_BASE_REGEN, PLAYER_SPEED,
} from "../../../shared/rules";
import { BASE_ATTACK_RANGE, BASE_PROJECTILE_SPEED } from "../constants";
import { TUTORIAL_FOREST_MAP_ID, type MapId } from "../world";
import type { createAutoFarmController } from "./auto-farm/auto-farm-controller";
import type { createBossController } from "./boss/boss-controller";
import type { createCombatEffects } from "./combat-effects";
import type { CoopAccess } from "./coop-access";
import type { createDuelRuntime } from "./duel/duel-runtime";
import type { createDuelSessionController } from "./duel/duel-session-controller";
import type { createEnemySimulation } from "./enemies/enemy-simulation";
import type { createGameBootstrap } from "./game-bootstrap";
import type { createMapController } from "./map-controller";
import type { PlayerCombatController } from "./player-combat-controller";
import { createPlayerController } from "./player-controller";
import type { createPlayerInputController } from "./player-input-controller";
import type { createPlayerStatsRuntime } from "./player-stats-runtime";
import type { createCamera } from "./render/camera";
import type { createCanvasRuntime } from "./render/canvas-runtime";
import type { DuelScene } from "./types";

export type LocalPlayerDeps = {
  coop: CoopAccess;
  world: ReturnType<typeof createGameBootstrap>;
  effects: Pick<ReturnType<typeof createCombatEffects>, "clear">;
  enemySimulation: Pick<ReturnType<typeof createEnemySimulation>, "clearRemoteCombat">;
  currentMapId: () => MapId;
  inTutorial: () => boolean;
  /** 3 under Run Wildstat Local.command, else 1. */
  localTestMultiplier: number;
  invalidateStaticWorld: () => void;
  spawnFromSite: Parameters<typeof createPlayerController>[0]["spawnFromSite"];
  playerCombat: PlayerCombatController;
  bossController: ReturnType<typeof createBossController>;
  mapController: ReturnType<typeof createMapController>;
  playerInput: Pick<ReturnType<typeof createPlayerInputController>, "movement">;
  playerVisibility: { noteActivity: (moving: boolean, farming: boolean) => void };
  autoFarm: ReturnType<typeof createAutoFarmController>;
  playerStats: ReturnType<typeof createPlayerStatsRuntime>;
  canvasRuntime: Pick<ReturnType<typeof createCanvasRuntime>, "viewport">;
  camera: ReturnType<typeof createCamera>;
  duelSession: Pick<ReturnType<typeof createDuelSessionController>,
    "activeDuel" | "isDueling" | "showDuelResult" | "showDuelResultUnavailable">;
  duelRuntime: ReturnType<typeof createDuelRuntime>;
  setHeldDuelScene: (scene: DuelScene | null) => void;
  /** Clears the frame clock and the HUD's passing messages after a reset. */
  onResetUI: () => void;
  /** The tutorial while it holds the player still. */
  inputBlocked: () => boolean;
};

/**
 * The local player each frame: movement from input or Auto Farm, collisions,
 * auto attack, syncing position to the server, and the duel the player is in.
 */
export function createLocalPlayer(deps: LocalPlayerDeps) {
  const { coop, world, mapController, bossController, autoFarm, playerCombat, duelSession, duelRuntime, currentMapId } = deps;
  const { player, bosses, inventory, mapConfig, projectileStore, spawnSites } = world;
  const client = coop.client;
  return createPlayerController({
    player, boss: bosses.dragon, enemies: world.enemies, spawnSites, decor: world.decor, paths: world.paths,
    clearTransientCombat: () => { projectileStore.clear(); deps.effects.clear(); deps.enemySimulation.clearRemoteCombat(); },
    getCurrentMapId: currentMapId,
    mapSpawn: mapId => mapId === TUTORIAL_FOREST_MAP_ID ? world.startSpawn : mapConfig[mapId].arrival,
    initialStats: {
      maxHp: PLAYER_BASE_HP, damage: PLAYER_BASE_DAMAGE, attackRate: DEFAULT_ATTACK_INTERVAL, projectileSpeed: BASE_PROJECTILE_SPEED,
      projectileCount: 1, attackRange: BASE_ATTACK_RANGE, armor: 0, regen: PLAYER_BASE_REGEN, speed: PLAYER_SPEED * deps.localTestMultiplier,
    },
    invalidateStaticWorld: deps.invalidateStaticWorld,
    spawnFromSite: deps.spawnFromSite,
    clearPlayerCombat: () => { playerCombat.clearPendingThrow(); },
    resetBosses: () => bossController.resetAll(),
    onResetUI: deps.onResetUI,
    movement: dt => {
      if (deps.inputBlocked()) return { x: 0, y: 0, source: "none" };
      const manual = deps.playerInput.movement(dt);
      deps.playerVisibility.noteActivity(Boolean(manual.x || manual.y), Boolean(autoFarm.targetType()));
      return autoFarm.movement(manual, dt);
    },
    isMapTransitioning: () => mapController.isMapTransitioning(),
    resolvePortalCollision: () => mapController.resolvePortalCollision(),
    resolveBossCollision: () => bossController.forMap(currentMapId())?.resolveCollision(),
    applyBossKnockback: dt => bossController.applyBossKnockback(dt),
    viewport: () => ({ ...deps.canvasRuntime.viewport(), zoom: deps.camera.zoom }),
    cameraPosition: () => deps.camera,
    isConnected: coop.connected,
    syncSpeed: speed => { if (client && !deps.inTutorial()) client.syncSpeed(speed); },
    movementSpeedMultiplier: deps.playerStats.movementMultiplier,
    regenerationPerSecond: deps.playerStats.regenerationPerSecond,
    healthMultiplierBonus: deps.playerStats.healthMultiplierBonus,
    syncMovementState: (x, y, vx, vy, inputSource, force, interestArea) => {
      if (deps.inTutorial()) return;
      client?.syncMovementState?.(x, y, vx, vy, inputSource, force, interestArea, {
        group: autoFarm.targetType(), camp: autoFarm.targetCamp(), hold: autoFarm.holdsGround(), sites: spawnSites,
      });
    },
    autoAttack: () => playerCombat.attackNearest(autoFarm.attackType(), autoFarm.targetCamp(), autoFarm.attackPriority()),
    isAutoAttackEnabled: () => !deps.inputBlocked() && isWeaponItem(inventory.equippedRightHand || inventory.equippedLeftHand),
    activeDuel: duelSession.activeDuel,
    isDueling: duelSession.isDueling,
    localIdentity: coop.localIdentity,
    localState: coop.localState,
    syncLiveDuelDamage: duel => duelRuntime.syncLiveDamageNumbers(duel),
    liveDuelScene: () => duelRuntime.liveScene(),
    setHeldDuelScene: deps.setHeldDuelScene,
    pulseDuel: () => { client?.pulseDuel?.(); },
    resetLiveDuelPresentation: () => duelRuntime.resetLivePresentation(),
    loadDuelReplay: async id => client?.loadDuelReplay?.(id) ?? null,
    showDuelResult: duelSession.showDuelResult,
    showDuelResultUnavailable: duelSession.showDuelResultUnavailable,
  });
}
