/**
 * What the portals show of where they lead, shared by the map controller (which knows each map's arrival) and the
 * world renderer (which paints it), as miningScene is.
 */
export const portalTravelScene = {
  /** Where a player from `from` steps out on a map: the middle of its glimpse. */
  arrival: null as ((mapId: string, from: string) => { x: number; y: number } | null) | null,
  /** When the player last stepped through, on performance.now(): the glimpse covers the new ground until its tiles land. */
  arrivedAt: -Infinity,
};
