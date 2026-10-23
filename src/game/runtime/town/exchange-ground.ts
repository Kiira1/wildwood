import { TOWN_EXCHANGE_PLAZA, TOWN_EXCHANGE_ROAD, TOWN_EXCHANGE_ROAD_JOIN } from "../../../../shared/town";
import type { WorldPath } from "../../world";

/**
 * The Trade Chrysanthemum's ground, in the village's own road tiles (forest-road.ts): the road off the village's
 * bottom road down to the market square, and the square, one outline of earth on the Town's meadow green.
 */
export const TOWN_EXCHANGE_GROUND = Object.freeze({
  paths: Object.freeze([
    ...TOWN_EXCHANGE_ROAD,
    { x: TOWN_EXCHANGE_PLAZA.left, y: TOWN_EXCHANGE_PLAZA.top, w: TOWN_EXCHANGE_PLAZA.right - TOWN_EXCHANGE_PLAZA.left, h: TOWN_EXCHANGE_PLAZA.bottom - TOWN_EXCHANGE_PLAZA.top },
  ]) as readonly WorldPath[],
  /** Nothing west of this is painted: there the branch lies on the village's own road, which shows instead. */
  join: TOWN_EXCHANGE_ROAD_JOIN,
  /** The Town's countryside green (map-design.ts), under a rounded corner. */
  grass: "#61864e",
});
