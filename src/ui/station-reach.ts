import { TOWN_FEET_OFFSET } from "../../shared/town";

type StationWindow = { isOpen: () => boolean; close: () => void };

/** Whether the player's feet are within `reach` of a station's spot (where its keeper's feet are). */
const withinStationReach = (player: { x: number; y: number }, at: { x: number; y: number }, reach: number) =>
  Math.hypot(player.x - at.x, player.y + TOWN_FEET_OFFSET - at.y) <= reach;

/**
 * A station's window opens as the player walks up; this closes it once they are past the server's reach (walked off,
 * or Auto Mine took them), where every button in it would only be refused.
 */
export function closeStationsOutOfReach(player: { x: number; y: number }, here: boolean,
  stations: readonly (readonly [StationWindow, { x: number; y: number }, number])[]) {
  for (const [window, at, reach] of stations) if (window.isOpen() && !(here && withinStationReach(player, at, reach))) window.close();
}
