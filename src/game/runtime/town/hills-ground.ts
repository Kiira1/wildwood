import { MINING_TRACK, MINING_TRACK_HALF_WIDTH } from "../../../../shared/mining";
import { GROVE_ROAD, GROVE_ROAD_HALF_WIDTH } from "../../../../shared/woodcutting";
import { HILLS_CLEARING_ROUND, HILLS_CLEARINGS, HILLS_EARTH_RIM, HILLS_ROUGH_MARGIN } from "../../town-world";

type Rect = { left: number; top: number; right: number; bottom: number };
type Point = { readonly x: number; readonly y: number };

/** The village ground's own colours (village-ground.webp): its darker grass, and its roads' earth and their rim. */
const DARK_GRASS = "#54783c";
const EARTH = "#b89474";
const EARTH_RIM = "#7c6044";

/** How far past a clearing's core the paint reaches: its earth, its rim and the darker grass round it. */
const CLEARING_REACH = HILLS_CLEARING_ROUND + HILLS_ROUGH_MARGIN;
const TRACK_REACH = MINING_TRACK_HALF_WIDTH + HILLS_EARTH_RIM;
const TRACK_BOX = {
  left: Math.min(...MINING_TRACK.map(point => point.x)) - TRACK_REACH, right: Math.max(...MINING_TRACK.map(point => point.x)) + TRACK_REACH,
  top: Math.min(...MINING_TRACK.map(point => point.y)) - TRACK_REACH, bottom: Math.max(...MINING_TRACK.map(point => point.y)) + TRACK_REACH,
};
const ROAD_REACH = GROVE_ROAD_HALF_WIDTH + HILLS_EARTH_RIM;
const ROAD_BOX = {
  left: Math.min(...GROVE_ROAD.map(point => point.x)) - ROAD_REACH, right: Math.max(...GROVE_ROAD.map(point => point.x)) + ROAD_REACH,
  top: Math.min(...GROVE_ROAD.map(point => point.y)) - ROAD_REACH, bottom: Math.max(...GROVE_ROAD.map(point => point.y)) + ROAD_REACH,
};
const near = (a: Rect, b: Rect, pad: number) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
/** All the hills paint, the road to Timberwood's too, in one rectangle. */
const PAINTED = HILLS_CLEARINGS.reduce((area, { box }) => ({
  left: Math.min(area.left, box.left - CLEARING_REACH), right: Math.max(area.right, box.right + CLEARING_REACH),
  top: Math.min(area.top, box.top - CLEARING_REACH), bottom: Math.max(area.bottom, box.bottom + CLEARING_REACH),
}), { left: Math.min(TRACK_BOX.left, ROAD_BOX.left), right: Math.max(TRACK_BOX.right, ROAD_BOX.right), top: Math.min(TRACK_BOX.top, ROAD_BOX.top), bottom: Math.max(TRACK_BOX.bottom, ROAD_BOX.bottom) });

/** Whether a rectangle of the world reaches the hills' ground at all. */
export const touchesHillsGround = (rect: Rect) => near(rect, PAINTED, 0);

function traceShape(context: CanvasRenderingContext2D, points: readonly Point[], ox: number, oy: number, closed: boolean) {
  context.beginPath();
  points.forEach((point, index) => (index ? context.lineTo(point.x - ox, point.y - oy) : context.moveTo(point.x - ox, point.y - oy)));
  if (closed) context.closePath();
}

/**
 * Paints the Copper Hills' ground into one of the Town's baked tiles, over the countryside's green and under its
 * props: each outcrop's clearing, one rounded shape of bare earth rimmed as the village's roads are, with the
 * darker grass worn round it, the miners' track out from the village through every vein, and the woodcutters' road
 * off it north to Timberwood. Every rim is laid before any earth, so where a clearing meets the track (or the road
 * the track) the two read as one piece of ground.
 */
export function paintHillsGround(context: CanvasRenderingContext2D, rect: Rect, ox: number, oy: number) {
  if (!touchesHillsGround(rect)) return;
  const clearings = HILLS_CLEARINGS.filter(clearing => near(clearing.box, rect, CLEARING_REACH));
  const track = near(TRACK_BOX, rect, 0), road = near(ROAD_BOX, rect, 0);
  if (!clearings.length && !track && !road) return;
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  // A rounded shape round a core: the core filled, and its outline drawn twice as wide as the margin, round at
  // every corner, so the shape reaches the margin out all round.
  const clearing = (core: readonly Point[], margin: number) => {
    traceShape(context, core, ox, oy, true);
    context.fill();
    context.lineWidth = margin * 2;
    context.stroke();
  };
  const path = (line: readonly Point[], half: number) => {
    traceShape(context, line, ox, oy, false);
    context.lineWidth = half * 2;
    context.stroke();
  };
  context.fillStyle = context.strokeStyle = DARK_GRASS;
  for (const { core } of clearings) clearing(core, CLEARING_REACH);
  context.fillStyle = context.strokeStyle = EARTH_RIM;
  for (const { core } of clearings) clearing(core, HILLS_CLEARING_ROUND + HILLS_EARTH_RIM);
  if (track) path(MINING_TRACK, TRACK_REACH);
  if (road) path(GROVE_ROAD, ROAD_REACH);
  context.fillStyle = context.strokeStyle = EARTH;
  for (const { core } of clearings) clearing(core, HILLS_CLEARING_ROUND);
  if (track) path(MINING_TRACK, MINING_TRACK_HALF_WIDTH);
  if (road) path(GROVE_ROAD, GROVE_ROAD_HALF_WIDTH);
  context.restore();
}
