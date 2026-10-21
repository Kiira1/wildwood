import { CAMPAIGN_ENDPOINT, CAMPAIGN_MAPS } from "./campaign-registry";
import { proceduralMapId, proceduralMapNumber } from "./procedural-map-core";
import { MAP_DISPLAY_NAMES } from "./rules";

/**
 * Onward (the Warden II card): the player's own boss kill that opens the next map takes them straight there. The
 * server moves them in the kill report (map-travel.ts travelOnward); the client follows with a one-line cue.
 */

/** The map a boss opens: the next campaign map, Endless 1 after the last one, Endless N + 1 after Endless N. */
export function nextMapAfter(mapId: string): string | null {
  const number = proceduralMapNumber(mapId);
  if (number !== null) return Number.isSafeInteger(number + 1) ? proceduralMapId(number + 1) : null;
  const index = CAMPAIGN_MAPS.findIndex(map => map.id === mapId);
  if (index < 0) return null;
  return CAMPAIGN_MAPS[index + 1]?.id ?? (mapId === CAMPAIGN_ENDPOINT.mapId ? proceduralMapId(1) : null);
}

/** "Warden II Card: On To Endless 12". */
export function onwardCueText(mapId: string) {
  const number = proceduralMapNumber(mapId);
  const name = number !== null ? `Endless ${number}` : (MAP_DISPLAY_NAMES[mapId] ?? mapId).replace(/ - \d+$/, "");
  return `Warden II Card: On To ${name}`;
}
