/**
 * What the portals show of where they lead, shared by the map controller (which knows each map's arrival) and the
 * world renderer (which paints it), as miningScene is.
 */
export const portalTravelScene = {
  /** Where a player steps out on a map: the middle of its glimpse. */
  arrival: null as ((mapId: string) => { x: number; y: number } | null) | null,
  /** A map's own portals, standing in its glimpse as they stand on the map. */
  portals: null as ((mapId: string) => readonly { x: number; y: number; width: number; height: number; destination: string }[]) | null,
  /** When the player last stepped through, on performance.now(): the glimpse covers the new ground until its tiles land. */
  arrivedAt: -Infinity,
};
