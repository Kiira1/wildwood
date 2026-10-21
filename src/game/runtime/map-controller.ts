import { beginTownTeleport, endTownTeleport } from "./town/town-teleport";
import { createPortalCutscene } from "./cutscene";
import { snapCameraToPlayer, type Camera } from "./render/camera";
import type { EnemyState, PlayerState } from "./types";
import { BOSS_KINDS, clearBossAttack, type BossHazards, type BossStates } from "./boss/boss-registry";
import { TUTORIAL_FOREST_MAP_ID, type MapId, type SpawnSite } from "../world";
import { BOSS_PORTAL_CUTSCENES, type PortalCutsceneBoss } from "./boss/boss-portal-cutscenes";
import { portalTravelScene } from "./render/portal-glimpse";
import { exitPortalFor, portalArrival, portalExitPoint } from "../../../shared/map-gateways";
import { MAP_IDS } from "../../../shared/rules";
import { isProceduralMap } from "../../../shared/procedural-maps";

export type MapPortal = { x: number; y: number; width: number; height: number; depth: number; destination: MapId; label?: string };

type MapConfig = Record<MapId, { portal: MapPortal | null; arrival: { x: number; y: number }; secondaryPortal?: MapPortal }>;

const PORTAL_TRIGGER_RADIUS = 48;
/** Walking this much deeper into a guarded portal than the player has been since the guard is walking into it on purpose. */
const PORTAL_WALK_IN = 6;
/** How long a map change waits for its fade's dark before it loads without it. */
const MAP_FADE_FALLBACK_MS = 5_000;

async function withMapDeadline<T>(work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Map transition timed out")), 30_000);
    })]);
  } finally {
    clearTimeout(timeout);
  }
}

/** Loads lazy destination art beside the server move and waits before revealing the new map. */
export async function prepareMapTransition(
  changeMap: () => Promise<boolean | undefined> | boolean | undefined,
  prepareAssets: () => Promise<void>,
) {
  return withMapDeadline((async () => {
    const assetsReady = prepareAssets();
    // Asset rejection may arrive before the reducer reply, including a denied
    // move. Handle it immediately; awaiting below still propagates a real failure.
    void assetsReady.catch(() => {});
    const changed = await changeMap();
    if (!changed) return false;
    await assetsReady;
    return true;
  })());
}

type TeleportArrival = { mapId: string; x: number; y: number; facing: number };

export type MapController = {
  teleportHome: () => Promise<boolean>;
  teleportToMap: (destination: MapId, request: () => Promise<boolean | TeleportArrival>) => Promise<boolean>;
  /** Leaves the Town through its travel portal for a destination the picker chose. */
  travelFromHome: (destination: MapId) => Promise<boolean>;
  /** The map the toolbar teleport last left for the Town, while this page has seen it. */
  homeDeparture: () => MapId | null;
  activePortal: () => MapPortal | null;
  secondaryPortal: () => MapPortal | null;
  portalIsUnlocked: (portal: MapPortal) => boolean;
  resolvePortalCollision: () => void;
  updatePortal: (dt: number) => void;
  loadMap: (mapId: MapId, x: number, y: number, facing?: number) => void;
  reconcileMapFromServer: () => void;
  /** The server has the player on another map (a move it made itself, as Onward does) that this page has yet to follow. */
  serverMovePending: () => boolean;
  queuePortalReveal: (mapId: MapId) => void;
  startProceduralPortalCutscene: () => boolean;
  startBossPortalCutscene: (boss: PortalCutsceneBoss) => boolean;
  updatePortalCutscene: (dt: number) => boolean;
  isCutsceneActive: () => boolean;
  isMapTransitioning: () => boolean;
  /** Through a portal and walking, while the server has yet to confirm the move: no other travel meanwhile. */
  isArrivalPending: () => boolean;
  cutscenePortal: () => MapPortal;
  portalRevealIntensity: () => number;
  portalBlackoutOpacity: () => number;
  portalDestinationOpacity: () => number;
};

/** Owns map travel, portal collisions, and cinematic portal state. */
export function createMapController(options: {
  /** The Town's portals open windows rather than travel: the destination picker, or the Soul Dimension's. */
  openTravel?: (portal: MapPortal) => void;
  /** Closes those windows: walking off the portal leaves it, as the server only sends a player on from beside it. */
  closeTravel?: () => void;
  onTravelStarted?: () => void;
  /** Whether Auto Farm is taking the player through a portal to this map: the arrival guard does not hold it back. */
  travelWanted?: (destination: string) => boolean;
  /** The server refused a crossing to this map. */
  onTravelRefused?: (destination: string) => void;
  mapConfig: MapConfig;
  markPortalCutsceneSeen: (cutscene: string) => void;
  getCurrentMapId: () => MapId;
  setCurrentMapId: (mapId: MapId) => void;
  player: PlayerState;
  camera: Camera;
  viewport: () => { width: number; height: number };
  keys: { clear: () => void };
  stopTouchMove: () => void;
  cutsceneOverlay: HTMLElement;
  resizeViewport: () => void;
  isDueling: () => boolean;
  running: () => boolean;
  localMapState: () => { mapId: string; x: number; y: number; facing: number } | null | undefined;
  changeMap: (mapId: MapId, x: number, y: number) => Promise<boolean | undefined> | boolean | undefined;
  prepareMapAssets: (mapId: MapId) => Promise<void>;
  /** Whether a destination's art is in hand, so a portal can swap maps on the spot while the server confirms. */
  instantTravelReady?: (mapId: MapId) => boolean;
  syncStoppedPosition: () => void;
  resetPresentationState: () => void;
  fadeToWorld: (action: () => void) => void;
  mapUnlocked: (mapId: MapId) => boolean;
  syncMapMusic: () => void;
  rebuildWorld: () => void;
  spawnFromSite: (site: SpawnSite) => void;
  enemies: EnemyState[];
  spawnSites: SpawnSite[];
  clearTransientCombat: () => void;
  bosses: BossStates;
  bossHazards: BossHazards;
  onCutsceneFinished: () => void;
  /** Told when the server moved the player from one map to another; true to show the departure shimmer (Onward's cue). */
  onServerMove?: (from: MapId, to: string) => boolean;
}): MapController {
  const {
    mapConfig,
    getCurrentMapId, setCurrentMapId, player, camera, viewport, keys, stopTouchMove, cutsceneOverlay, resizeViewport,
    isDueling, running, localMapState, changeMap, syncStoppedPosition, resetPresentationState, fadeToWorld, mapUnlocked, syncMapMusic,
    rebuildWorld, spawnFromSite, enemies, spawnSites, clearTransientCombat,
    bosses, bossHazards, onCutsceneFinished,
  } = options;
  const portalCutscene = createPortalCutscene();
  let mapTransitioning = false;
  let arrivalPending = false;
  let mapLoadGeneration = 0;
  let portalCooldown = 0;
  let portalExitGuard: MapPortal | null = null;
  /** How close to the guarded portal's middle the player has been since the guard: deeper than that is walking in. */
  let guardClosest = Infinity;
  /**
   * Until stepped off: a portal just come through (the walk carries on across its middle and out, which is not walking
   * back in) and the Town's pads (walking about on one after Back never reopens its window).
   */
  let guardUntilStepOff = false;
  function guardPortal(portal: MapPortal | null, untilStepOff = false) {
    portalExitGuard = portal;
    guardClosest = portal ? portalDistance(portal) : Infinity;
    guardUntilStepOff = untilStepOff;
  }
  let homeDeparture: MapId | null = null;
  let portalCutsceneIntensity = -1;
  let portalCutsceneBlackoutOpacity = 0;
  let portalCutsceneDestinationOpacity = 0;
  let pendingPortalReveal: { mapId: MapId; portal: MapPortal } | null = null;
  let portalCutsceneSeenKey = BOSS_PORTAL_CUTSCENES.dragon.seenKey as string;
  const initialPortal = mapConfig[TUTORIAL_FOREST_MAP_ID].portal;
  if (!initialPortal) throw new Error("Tutorial map requires an introductory portal.");
  let portalCutscenePortal: MapPortal = initialPortal;
  // A glimpse is painted before anyone walks in: centred where the player steps out.
  portalTravelScene.arrival = (mapId, from) => mapId in mapConfig ? arrivalFrom(mapId as MapId, from as MapId) : null;

  /**
   * Where the server lands a traveller from `from` (map-travel.ts): on a campaign or Endless map, out of its portal
   * back, at the point drawn from where they stood (`at`, as sent to the server); without it, that circle's middle.
   */
  function arrivalFrom(destination: MapId, from: MapId, at?: { x: number; y: number }) {
    const exit = exitFor(destination, from);
    return exit ? (at ? portalArrival(exit, at) : portalExitPoint(exit)) : mapConfig[destination].arrival;
  }
  function exitFor(destination: MapId, from: MapId) {
    const entry = mapConfig[destination];
    const travelled = (MAP_IDS as readonly string[]).includes(destination) || isProceduralMap(destination);
    const portals = travelled ? [entry.portal, entry.secondaryPortal].filter((portal): portal is MapPortal => Boolean(portal)) : [];
    return exitPortalFor(destination, portals, from, from === "town");
  }


  /**
   * The map loads on the fade's dark, and loading is what ends the travel lock.
   * A fade that never calls back would hold the player at the portal, unable to
   * move or teleport until a reload, so the load also runs on a timer.
   */
  function fadeToMap(load: () => void) {
    let done = false;
    const once = () => { if (done) return; done = true; load(); };
    fadeToWorld(once);
    setTimeout(once, MAP_FADE_FALLBACK_MS);
  }

  async function teleport(destination?: MapId, request?: () => Promise<boolean | TeleportArrival>) {
    if (!running() || player.hp <= 0 || isDueling() || mapTransitioning || arrivalPending || portalCutscene.active) return false;
    if (destination === getCurrentMapId() && !request) return true;
    options.onTravelStarted?.();
    mapTransitioning = true;
    const attempt = ++mapLoadGeneration;
    const departure = getCurrentMapId();
    const returning = departure === "town";
    let finished = false;
    const current = () => !finished && attempt === mapLoadGeneration && running() && player.hp > 0;
    try {
      keys.clear(); stopTouchMove(); player.moving = false;
      syncStoppedPosition();
      beginTownTeleport();
      // Bound the whole operation, including reducer acknowledgement and art.
      // A late completion may update server state, but must never revive this
      // presentation; normal reconciliation handles the authoritative map.
      const travel = async () => {
        await new Promise(resolve => setTimeout(resolve, 650));
        if (!current()) return false;
        const changed = request ? await request() : await changeMap("town", player.x, player.y);
        if (!current() || !changed) return false;
        const arrival = typeof changed === "object" ? changed : null;
        let state = arrival ?? localMapState();
        while (current() && (!state || (destination ? state.mapId !== destination : (state.mapId === "town") === returning))) {
          await new Promise(resolve => setTimeout(resolve, 25));
          state = localMapState();
        }
        if (!current() || !state || !(state.mapId in mapConfig)) return false;
        await options.prepareMapAssets(state.mapId as MapId);
        if (!current()) return false;
        // Re-read after loading: reconnect/reset may have replaced the arrival.
        const latest = arrival ?? localMapState();
        if (!latest || latest.mapId !== state.mapId) return false;
        if (latest.mapId === getCurrentMapId()) {
          player.x = latest.x; player.y = latest.y; player.facing = latest.facing;
          player.moving = false;
          guardPortalContainingPlayer();
        } else loadMap(latest.mapId as MapId, latest.x, latest.y, latest.facing);
        snapCameraToPlayer(camera, player, viewport()); resetPresentationState();
        beginTownTeleport(true);
        if ((!destination || destination === "town") && !returning) homeDeparture = departure;
        return true;
      };
      return await withMapDeadline(travel());
    } catch {
      return false;
    } finally {
      finished = true;
      if (attempt === mapLoadGeneration) {
        endTownTeleport();
        mapTransitioning = false;
      }
    }
  }

  function activePortal() { return mapConfig[getCurrentMapId()].portal; }
  function secondaryPortal() { return mapConfig[getCurrentMapId()].secondaryPortal ?? null; }
  function portalIsUnlocked(portal: MapPortal) { return portal.destination === TUTORIAL_FOREST_MAP_ID || mapUnlocked(portal.destination); }

  function portalDistance(portal: MapPortal) {
    return Math.hypot(player.x - portal.x, player.y - (portal.y - portal.height * .32));
  }
  function playerIsInsidePortal(portal: MapPortal) {
    return portalDistance(portal) <= PORTAL_TRIGGER_RADIUS;
  }

  function guardPortalContainingPlayer() {
    guardPortal([activePortal(), secondaryPortal()]
      .filter((portal): portal is MapPortal => portal !== null)
      .find(playerIsInsidePortal) ?? null);
  }
  /**
   * A guarded portal lets the player through once they step out of it. One they were loaded in (a reload, an update)
   * or sent back to (a refused trip) also lets them through when they walk deeper into it: walking into the arch
   * they stood in after an update did nothing until they had walked off and come back.
   */
  function guardHolds(guard: MapPortal) {
    if (!playerIsInsidePortal(guard)) return false;
    if (guardUntilStepOff) return true;
    const distance = portalDistance(guard);
    if (distance < guardClosest - PORTAL_WALK_IN) return false;
    guardClosest = Math.min(guardClosest, distance);
    return true;
  }

  function portalColliders() {
    return [activePortal(), secondaryPortal()].filter((portal): portal is MapPortal => portal !== null).flatMap((portal) => [
      { x: portal.x - portal.width * .32, y: portal.y - 52, r: 22 },
      { x: portal.x + portal.width * .32, y: portal.y - 52, r: 22 },
    ]);
  }

  function resolvePortalCollision() {
    for (const obstacle of portalColliders()) {
      const dx = player.x - obstacle.x;
      const dy = player.y - obstacle.y;
      const minimumDistance = player.r + obstacle.r;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= minimumDistance * minimumDistance) continue;
      const distance = Math.sqrt(distanceSquared);
      const nx = distance > .001 ? dx / distance : (player.x < obstacle.x ? -1 : 1);
      const ny = distance > .001 ? dy / distance : 0;
      player.x = obstacle.x + nx * minimumDistance;
      player.y = obstacle.y + ny * minimumDistance;
    }
  }

  function loadMap(mapId: MapId, x: number, y: number, facing = 0) {
    if (pendingPortalReveal?.mapId !== mapId) pendingPortalReveal = null;
    mapLoadGeneration++;
    endTownTeleport();
    mapTransitioning = false;
    // Any other map load supersedes a portal arrival still awaiting the server.
    arrivalPending = false;
    void options.prepareMapAssets(mapId);
    setCurrentMapId(mapId);
    syncMapMusic();
    player.x = x;
    player.y = y;
    player.facing = facing;
    player.moving = false;
    guardPortalContainingPlayer();
    enemies.length = 0;
    spawnSites.length = 0;
    clearTransientCombat();
    // No boss attack or hazard follows the player to the next map.
    for (const kind of BOSS_KINDS) {
      bossHazards[kind].length = 0;
      clearBossAttack(kind, bosses[kind]);
    }
    rebuildWorld();
    for (const site of spawnSites) spawnFromSite(site);
  }

  function updatePortal(dt: number) {
    if (pendingPortalReveal && pendingPortalReveal.mapId !== getCurrentMapId()) pendingPortalReveal = null;
    if (pendingPortalReveal && !mapTransitioning && !portalCutscene.active && !isDueling() && player.hp > 0
      && mapUnlocked(pendingPortalReveal.portal.destination)) {
      const reveal = pendingPortalReveal;
      pendingPortalReveal = null;
      startMapPortalCutscene(reveal.portal, "");
    }
    portalCooldown = Math.max(0, portalCooldown - dt);
    if (mapTransitioning || arrivalPending || portalCutscene.active || portalCooldown > 0 || isDueling()) return;
    if (portalExitGuard) {
      // A reload mid Move On lands the player in the portal, where Auto Farm stood for good waiting for a step out.
      if (guardHolds(portalExitGuard) && !options.travelWanted?.(portalExitGuard.destination)) return;
      guardPortal(null);
      if (getCurrentMapId() === "town") options.closeTravel?.();
    }
    const portal = [activePortal(), secondaryPortal()].filter((candidate): candidate is MapPortal => candidate !== null).find((candidate) =>
      playerIsInsidePortal(candidate),
    );
    if (!portal || !portalIsUnlocked(portal)) return;
    // The Town's portals open a window (the map picker, the Soul Dimension's) that does the travelling.
    if (getCurrentMapId() === "town" && options.openTravel) {
      // The picker chooses the destination. Guarding the pad means standing
      // on it after Back never reopens the window; walking off and on does.
      guardPortal(portal, true);
      keys.clear(); stopTouchMove(); player.moving = false;
      options.openTravel(portal);
      return;
    }
    options.onTravelStarted?.();
    mapTransitioning = true;
    const destination = portal.destination;
    const departure = getCurrentMapId();
    // Walking straight through leaves the player's input alone: they walk on as long as they hold it, no longer.
    if (options.instantTravelReady?.(destination)) { void travelThroughPortal(portal, destination); return; }
    keys.clear();
    stopTouchMove();
    player.moving = false;
    const attempt = mapLoadGeneration;
    const from = { x: player.x, y: player.y };
    void prepareMapTransition(
      () => changeMap(destination, from.x, from.y),
      () => options.prepareMapAssets(destination),
    ).then((changed) => {
      if (attempt !== mapLoadGeneration) return;
      if (!changed) {
        mapTransitioning = false;
        guardPortal(portal);
        portalCooldown = 1;
        crossingRefused(destination);
        return;
      }
      const arrival = arrivalFrom(destination, departure, from);
      fadeToMap(() => {
        if (attempt !== mapLoadGeneration) return;
        loadMap(destination, arrival.x, arrival.y, player.facing);
        guardUntilStepOff = true;
        snapCameraToPlayer(camera, player, viewport());
        resetPresentationState();
        syncStoppedPosition();
        mapTransitioning = false;
      });
    }).catch(() => {
      if (attempt !== mapLoadGeneration) return;
      mapTransitioning = false;
      guardPortal(portal);
      portalCooldown = 1;
      crossingRefused(destination);
    });
  }

  /**
   * A refusal means the server sees the player somewhere else. Auto Farm stops walking straight back in (a client
   * retried one every six seconds for ten minutes), and a map the server already has them on is followed now.
   */
  function crossingRefused(destination: MapId) {
    options.onTravelRefused?.(destination);
    reconcileMapFromServer();
  }

  /**
   * Walks straight through: the destination is on screen the same frame and the player walks on at once, out of
   * the portal back. Their movement is held from the server until it confirms the move (presence-service), then
   * where they stand is sent. A refusal puts the player back in the portal they walked into.
   */
  function travelThroughPortal(portal: MapPortal | null, destination: MapId): Promise<boolean> {
    const departure = { mapId: getCurrentMapId(), x: player.x, y: player.y, facing: player.facing };
    const arrival = arrivalFrom(destination, departure.mapId, departure);
    const move = Promise.resolve(changeMap(destination, departure.x, departure.y));
    loadMap(destination, arrival.x, arrival.y, departure.facing);
    guardUntilStepOff = true;
    // The camera moves as far as the player did, so the arch holds its place on screen and the follow keeps its ease.
    camera.x += player.x - departure.x;
    camera.y += player.y - departure.y;
    resetPresentationState();
    portalTravelScene.arrivedAt = performance.now();
    arrivalPending = true;
    const attempt = mapLoadGeneration;
    const goBack = () => {
      if (attempt !== mapLoadGeneration) return false;
      arrivalPending = false;
      loadMap(departure.mapId, departure.x, departure.y, departure.facing);
      snapCameraToPlayer(camera, player, viewport());
      resetPresentationState();
      syncStoppedPosition();
      if (portal) guardPortal(portal);
      portalCooldown = 1;
      crossingRefused(destination);
      return false;
    };
    return withMapDeadline(move).then((changed) => {
      if (attempt !== mapLoadGeneration) return false;
      if (!changed) return goBack();
      arrivalPending = false;
      syncStoppedPosition();
      return true;
    }, goBack);
  }

  /** A first-time portal cutscene showing, or about to start now the server opened its portal. */
  function cutsceneDue() {
    return portalCutscene.active || Boolean(pendingPortalReveal && pendingPortalReveal.mapId === getCurrentMapId()
      && player.hp > 0 && mapUnlocked(pendingPortalReveal.portal.destination));
  }

  function serverMovePending() {
    if (!running() || arrivalPending || isDueling()) return false;
    const state = localMapState();
    return Boolean(state && state.mapId !== getCurrentMapId() && state.mapId in mapConfig);
  }

  /** Follows a move the server made: after any portal cutscene, it fades to the server's map and spot. */
  function reconcileMapFromServer() {
    if (mapTransitioning || cutsceneDue() || !serverMovePending()) return;
    const state = localMapState()!;
    mapTransitioning = true;
    const attempt = mapLoadGeneration;
    const shimmer = options.onServerMove?.(getCurrentMapId(), state.mapId) ?? false;
    if (shimmer) { keys.clear(); stopTouchMove(); player.moving = false; beginTownTeleport(); }
    void withMapDeadline(options.prepareMapAssets(state.mapId as MapId)).then(() => {
      if (attempt !== mapLoadGeneration) return;
      fadeToMap(() => {
        if (attempt !== mapLoadGeneration) return;
        loadMap(state.mapId as MapId, state.x, state.y, state.facing);
        snapCameraToPlayer(camera, player, viewport());
        resetPresentationState();
        if (shimmer) beginTownTeleport(true);
        mapTransitioning = false;
      });
    }).catch(() => {
      if (attempt !== mapLoadGeneration) return;
      if (shimmer) endTownTeleport();
      mapTransitioning = false;
    });
  }

  function startMapPortalCutscene(portal: MapPortal | null, seenKey: string) {
    if (!portal || portalCutscene.active || !mapUnlocked(portal.destination)) return false;
    // A local boss death is provisional until its reward unlock is acknowledged.
    // Warming destination art must not turn a failed request into an unhandled rejection.
    void options.prepareMapAssets(portal.destination).catch(() => {});
    document.body.classList.add("is-cutscene");
    resizeViewport();
    portalCutscene.begin(camera, { x: portal.x, y: portal.y - portal.height * .48 }, viewport());
    portalCutsceneIntensity = 0;
    portalCutsceneBlackoutOpacity = 0;
    portalCutsceneDestinationOpacity = 0;
    portalCutscenePortal = portal;
    portalCutsceneSeenKey = seenKey;
    keys.clear();
    stopTouchMove();
    cutsceneOverlay.hidden = false;
    return true;
  }

  function startBossPortalCutscene(boss: PortalCutsceneBoss) {
    const scene = BOSS_PORTAL_CUTSCENES[boss];
    return startMapPortalCutscene(mapConfig[scene.mapId][scene.portal] ?? null, scene.seenKey);
  }

  function updatePortalCutscene(dt: number) {
    const frame = portalCutscene.update(dt);
    camera.x = frame.camera.x;
    camera.y = frame.camera.y;
    camera.zoom = frame.camera.zoom;
    portalCutsceneIntensity = frame.portalIntensity;
    portalCutsceneBlackoutOpacity = frame.blackoutOpacity;
    portalCutsceneDestinationOpacity = frame.destinationOpacity;
    if (!frame.finished) return true;
    portalCutsceneIntensity = -1;
    portalCutsceneBlackoutOpacity = 0;
    portalCutsceneDestinationOpacity = 0;
    cutsceneOverlay.hidden = true;
    document.body.classList.remove("is-cutscene");
    resizeViewport();
    if (portalCutsceneSeenKey) options.markPortalCutsceneSeen(portalCutsceneSeenKey);
    onCutsceneFinished();
    // A move the server made meanwhile (Onward) waited for the cutscene.
    reconcileMapFromServer();
    return false;
  }

  return {
    teleportHome: () => teleport(),
    teleportToMap: (destination, request) => teleport(destination, request),
    travelFromHome: async (destination) => {
      if (getCurrentMapId() !== "town" || destination === "town" || destination === "home_exterior") return false;
      // A campaign or Endless map whose art is in hand opens straight away, as a walk-in portal does.
      const plain = (MAP_IDS as readonly string[]).includes(destination) || isProceduralMap(destination);
      if (plain && options.instantTravelReady?.(destination) && running() && player.hp > 0 && !isDueling() && !mapTransitioning && !arrivalPending && !portalCutscene.active) {
        options.onTravelStarted?.();
        keys.clear(); stopTouchMove(); player.moving = false;
        // Out of the picker's pad, as from a walk-in portal: the server measures from the same pad.
        return travelThroughPortal(mapConfig.town.portal, destination);
      }
      return teleport(destination, async () => Boolean(await changeMap(destination, player.x, player.y)));
    },
    homeDeparture: () => homeDeparture,
    activePortal,
    secondaryPortal,
    portalIsUnlocked,
    resolvePortalCollision,
    updatePortal,
    loadMap,
    reconcileMapFromServer,
    serverMovePending,
    queuePortalReveal: (mapId) => {
      if (mapId !== getCurrentMapId()) return;
      const portal = mapConfig[mapId].secondaryPortal;
      // Capture the locked -> earned transition before queuing the authoritative reward.
      if (portal && !mapUnlocked(portal.destination)) pendingPortalReveal = { mapId, portal };
    },
    startProceduralPortalCutscene: () => {
      if (mapTransitioning || portalCutscene.active || isDueling()) return false;
      const mapId = getCurrentMapId();
      const portal = mapConfig[mapId].secondaryPortal;
      if (!mapId.startsWith("endless_") || !portal) return false;
      return startMapPortalCutscene(portal, "");
    },
    startBossPortalCutscene,
    updatePortalCutscene,
    isCutsceneActive: () => portalCutscene.active,
    isMapTransitioning: () => mapTransitioning,
    isArrivalPending: () => arrivalPending,
    cutscenePortal: () => portalCutscenePortal,
    portalRevealIntensity: () => portalCutsceneIntensity,
    portalBlackoutOpacity: () => portalCutsceneBlackoutOpacity,
    portalDestinationOpacity: () => portalCutsceneDestinationOpacity,
  };
}
