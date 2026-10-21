import { CAMPAIGN_MAPS } from "./campaign-registry";
import { MAP_EDITOR_GAMEPLAY_OVERRIDES } from "./map-editor-overrides";
import { TUTORIAL_FOREST_MAP_ID, PLAYER_RADIUS, PLAYER_SPAWN, WORLD_HEIGHT, WORLD_WIDTH } from "./rules";
import { mapRandom } from "./procedural-map-core";

/**
 * Where each campaign map's portals stand and where a player arriving lands.
 * The client draws these and the server checks portal use against them, so
 * they live here once.
 */
export type MapGatewayPortal = { x: number; y: number; width: number; height: number; depth: number; destination: string };
export type MapGateways = { arrival: { x: number; y: number }; portals: MapGatewayPortal[] };

const PORTAL_SIZE = 198;
const portalAt = (x: number, y: number, destination: string): MapGatewayPortal =>
  ({ x, y, width: PORTAL_SIZE, height: PORTAL_SIZE, depth: y, destination });

/** The spot a player has to stand near to use a portal: its art's base is y, the gate's middle a third of its height up. */
export function portalUsePoint(portal: MapGatewayPortal) {
  return { x: portal.x, y: portal.y - portal.height * .32, destination: portal.destination };
}

/** Back and on stand this far apart, half of it either side of the map's gateway point. */
export const GATEWAY_PORTAL_SPACING = 220;
/** A player arriving lands this far below the portals' feet, between them. */
export const GATEWAY_ARRIVAL_DROP = 90;

/**
 * Where a campaign map's portals stand: the middle of the map. Where enemies
 * reach the middle they stand at the nearest spot clear of them instead. map-gateways.test.ts holds
 * every map's portals and arrival clear of its enemies, boss and decor.
 */
export const MAP_MIDDLE: Readonly<{ x: number; y: number }> = Object.freeze({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 });
export const GATEWAY_POINT_NUDGES: Readonly<Record<string, { x: number; y: number }>> = {
  // Mossfall Ruins' region covers the middle and Glass Thicket's Needles spawn 300 from it. Clear
  // of a 300-aggro elite at every forest spawn too: the Soul Dimension fills them with its own.
  // The forest's portal comes from the map editor (shared/map-designs.json), laid out on this point.
  [TUTORIAL_FOREST_MAP_ID]: { x: 2240, y: 2810 },
  // A Whiteout Reaper (an elite, 340 aggro) spawns 220 from the middle.
  intermediate_snowlands: { x: 2300, y: 2190 },
};
export function gatewayPoint(mapId: string) {
  return { ...(GATEWAY_POINT_NUDGES[mapId] ?? MAP_MIDDLE) };
}

/**
 * The layout around a gateway point: back to the previous map on the left,
 * on to the next on the right, the arrival just below between them, so a
 * player who arrives stands by both. The forest has only the way on, so it
 * stands on the point itself.
 */
export function middleGateways(point: { x: number; y: number }, back: string | null, next: string | null): MapGateways {
  const half = back !== null && next !== null ? GATEWAY_PORTAL_SPACING / 2 : 0;
  return {
    arrival: { x: point.x, y: point.y + GATEWAY_ARRIVAL_DROP },
    portals: [...(back !== null ? [portalAt(point.x - half, point.y, back)] : []), ...(next !== null ? [portalAt(point.x + half, point.y, next)] : [])],
  };
}

const LAST_CAMPAIGN_MAP = CAMPAIGN_MAPS[CAMPAIGN_MAPS.length - 1];

/** A map editor layout wins (the forest's and the desert's, laid out the same way). */
function campaignGateways(index: number): MapGateways {
  const map = CAMPAIGN_MAPS[index], previous = CAMPAIGN_MAPS[index - 1], next = CAMPAIGN_MAPS[index + 1];
  const edit = MAP_EDITOR_GAMEPLAY_OVERRIDES[map.id];
  if (edit?.portals.length) return { arrival: { ...edit.arrival }, portals: edit.portals.map(portal => ({ ...portal })) };
  // The last map's right-hand place is its way into Endless (endlessEntryPortal), added by the client and server.
  const laidOut = middleGateways(gatewayPoint(map.id), previous?.id ?? null, next?.id ?? (map === LAST_CAMPAIGN_MAP ? "" : null));
  return { ...laidOut, portals: laidOut.portals.filter(portal => portal.destination) };
}

export const CAMPAIGN_GATEWAYS: Readonly<Record<string, MapGateways>> =
  Object.fromEntries(CAMPAIGN_MAPS.map((map, index) => [map.id, campaignGateways(index)]));

/**
 * Where a traveller lands on a campaign map. Tutorial Forest's land at its starting spot (PLAYER_SPAWN), as new
 * characters and the dead do: its portal's arrival is among enemies a fresh character cannot beat.
 */
export function campaignLanding(mapId: string) {
  return mapId === TUTORIAL_FOREST_MAP_ID ? { ...PLAYER_SPAWN } : CAMPAIGN_GATEWAYS[mapId] && { ...CAMPAIGN_GATEWAYS[mapId].arrival };
}

/** How far in front of a portal's feet the middle of a traveller's landing stands: clear of its trigger and pillars. */
export const PORTAL_EXIT_DROP = 74;
/** Travellers land anywhere within this of that middle, so several coming through together stand apart. */
export const PORTAL_EXIT_SPREAD = 45;

/**
 * The portal a traveller from `from` comes out of: the one leading back there. From the Town, a campaign map's
 * way back (its first portal; Tutorial Forest has none, and keeps its landing). Null when there is none.
 */
export function exitPortalFor<P extends { destination: string }>(mapId: string, portals: readonly P[], from: string, fromTown: boolean): P | null {
  return portals.find(portal => portal.destination === from)
    ?? (fromTown && CAMPAIGN_GATEWAYS[mapId] && mapId !== TUTORIAL_FOREST_MAP_ID ? portals[0] ?? null : null);
}

/**
 * The middle of where a traveller comes out of `exit`: in front of it, outside its trigger, so walking
 * back into it works at once.
 */
export function portalExitPoint(exit: { x: number; y: number }) {
  return { x: exit.x, y: exit.y + PORTAL_EXIT_DROP };
}

/**
 * Where a traveller comes out of `exit`: a point in the circle round its middle, drawn from where they stood
 * when they used the way in (`from`). The server is sent that spot and the client knows it, so both pick the same point.
 */
export function portalArrival(exit: { x: number; y: number }, from: { x: number; y: number }) {
  const middle = portalExitPoint(exit);
  let seed = 0x811c9dc5;
  for (const value of [from.x, from.y, exit.x, exit.y]) seed = Math.imul(seed ^ (Math.round(value * 1000) | 0), 0x01000193);
  const random = mapRandom(seed);
  // Square samples kept inside the circle and the map; pure arithmetic, so every engine draws the same point.
  for (let tries = 0; tries < 16; tries++) {
    const dx = random() * 2 - 1, dy = random() * 2 - 1;
    const x = middle.x + dx * PORTAL_EXIT_SPREAD, y = middle.y + dy * PORTAL_EXIT_SPREAD;
    if (dx * dx + dy * dy <= 1 && x >= PLAYER_RADIUS && y >= PLAYER_RADIUS && x <= WORLD_WIDTH - PLAYER_RADIUS && y <= WORLD_HEIGHT - PLAYER_RADIUS) return { x, y };
  }
  return middle;
}

/** The last campaign map's portal into Endless (`destination`, its first map): where a next portal would stand. */
export function endlessEntryPortal(destination: string): MapGatewayPortal {
  return middleGateways(gatewayPoint(LAST_CAMPAIGN_MAP.id), CAMPAIGN_MAPS[CAMPAIGN_MAPS.length - 2].id, destination).portals[1];
}

/** The middles of where travellers come out of a campaign map's portals (the Endless one too). */
export function gatewayLandings(mapId: string): { x: number; y: number }[] {
  const gateways = CAMPAIGN_GATEWAYS[mapId];
  if (!gateways) return [];
  return [...gateways.portals, ...(mapId === LAST_CAMPAIGN_MAP.id ? [endlessEntryPortal("")] : [])].map(portalExitPoint);
}

/** The spots on a campaign map that stand clear of decor: each portal's gate (the Endless one too) and the arrival. */
export function gatewayClearings(mapId: string): { x: number; y: number }[] {
  const gateways = CAMPAIGN_GATEWAYS[mapId];
  if (!gateways) return [];
  const portals = [...gateways.portals, ...(mapId === LAST_CAMPAIGN_MAP.id ? [endlessEntryPortal("")] : [])];
  return [...portals.map(portal => ({ x: portal.x, y: portal.y - portal.height / 2 })), { ...gateways.arrival }];
}
