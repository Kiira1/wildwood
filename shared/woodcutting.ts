import { campaignMapUnlocked, type CampaignAccess } from "./equipment-access";
import type { WoodId } from "./crafting";
import { MINING_TRACK } from "./mining";
import { MAP_DISPLAY_NAMES, MAP_IDS } from "./rules";
import { TOWN_GROVE, TOWN_HILLS, townRandom } from "./town";

/**
 * Woodcutting, in Timberwood north of the Copper Hills (TOWN_GROVE): walk up to a tree with a hatchet and you chop
 * it, as you mine a rock, and it falls into logs for crafting. Peaceful, as the hills are.
 *
 * - Four stands, west to east: pine nearest the road in, then oak, yew and elder, each opening with the map whose
 *   grade of gear its wood crafts (as the ore veins open, shared/mining.ts).
 * - Every tree raises the Woodcutting stat, which makes chopping faster. Prestige never resets it.
 * - Each player has their own trees: a felled tree is a stump for them alone until it grows back.
 *
 * The trees are laid from their coordinates alone, the same for every client and the server: in staggered rows,
 * so whoever chops one stands in view, with no spot in reach of two.
 */

export type WoodTreeKind = "pine" | "oak" | "yew" | "elder";
export const WOOD_TREE_KINDS: readonly WoodTreeKind[] = Object.freeze(["pine", "oak", "yew", "elder"]);

export type WoodStand = {
  kind: WoodTreeKind;
  /** "Pine Tree": what its trees are called. */
  name: string;
  log: WoodId;
  /** The first gear tier its wood crafts: the stand opens with that tier's map. */
  firstTier: number;
  /** How much longer its trees take to fell than pine's: twice as long a grade. */
  hardness: number;
  /** How many trees it holds: the deeper the stand, the scarcer. */
  trees: number;
  /** The band of the grove it fills, west to east. */
  left: number;
  right: number;
};
const band = (from: number, to: number) => ({ left: TOWN_GROVE.left + from, right: TOWN_GROVE.left + to });
export const WOOD_STANDS: readonly WoodStand[] = Object.freeze([
  { kind: "pine", name: "Pine Tree", log: "pine_log", firstTier: 1, hardness: 1, trees: 16, ...band(0, 1_250) },
  { kind: "oak", name: "Oak Tree", log: "oak_log", firstTier: 5, hardness: 2, trees: 14, ...band(1_250, 2_300) },
  { kind: "yew", name: "Yew Tree", log: "yew_log", firstTier: 9, hardness: 4, trees: 12, ...band(2_300, 3_300) },
  { kind: "elder", name: "Elder Tree", log: "elder_log", firstTier: 13, hardness: 8, trees: 10, ...band(3_300, 4_200) },
] as const);
/** Each kind's stand, by kind. */
export const WOOD_TREES: Readonly<Record<WoodTreeKind, WoodStand>> = Object.freeze(Object.fromEntries(WOOD_STANDS.map(stand => [stand.kind, stand])) as Record<WoodTreeKind, WoodStand>);

/** How long a new woodcutter takes to fell a pine (a stand's hardness multiplies it, Woodcutting divides it), and its logs. */
export const WOODCUTTING_CHOP_SECONDS = 8;
export const WOODCUTTING_LOGS = 2;
/** How long a felled tree stays a stump for the player who felled it. */
export const WOODCUTTING_RESPAWN_SECONDS = 120;

/** How close a player's feet come to a tree's foot to chop it, and the server's allowance on top for lag (as mining's). */
export const WOODCUTTING_REACH = 70;
export const WOODCUTTING_SERVER_REACH = 120;
/** The server takes a fall this soon at the earliest, as a share of the tree's time: clocks and packets wander. */
export const WOODCUTTING_RATE_SLACK = .75;

export type WoodTree = { id: number; x: number; y: number; kind: WoodTreeKind; stand: number; log: WoodId };

// ---- How the grove is laid ----

type Point = { readonly x: number; readonly y: number };

/**
 * The woodcutters' road: off the miners' track at its bend before the hills, north past their west edge, to the
 * pine stand's west side. Its centre line, a point every few units; the trees keep off it.
 */
const hills = (dx: number, dy: number): Point => ({ x: TOWN_HILLS.left + dx, y: TOWN_HILLS.top + dy });
/** The track's point nearest its bend before the hills, where the road leaves it. */
const BEND = hills(-760, 608);
const ROAD_FORK = MINING_TRACK.reduce((best, point) =>
  (point.x - BEND.x) ** 2 + (point.y - BEND.y) ** 2 < (best.x - BEND.x) ** 2 + (best.y - BEND.y) ** 2 ? point : best);
const ROAD_WAYPOINTS: readonly Point[] = [ROAD_FORK, hills(-700, 300), hills(-610, -80), hills(-510, -450), hills(-400, -800)];
function straightLine(points: readonly Point[], step: number): Point[] {
  const line: Point[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    const a = points[index], b = points[index + 1], steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let s = 0; s < steps; s++) line.push({ x: Math.round(a.x + (b.x - a.x) * s / steps), y: Math.round(a.y + (b.y - a.y) * s / steps) });
  }
  line.push(points[points.length - 1]);
  return line;
}
export const GROVE_ROAD: readonly Point[] = Object.freeze(straightLine(ROAD_WAYPOINTS, 40));
/** Half the road's width: a little narrower than the miners' track. */
export const GROVE_ROAD_HALF_WIDTH = 36;
/** How far a point is from the road's centre line, squared; anything further than `beyond` from its box is Infinity. */
export function groveRoadDistanceSquared(x: number, y: number, beyond = Infinity) {
  const left = Math.min(...ROAD_WAYPOINTS.map(p => p.x)), right = Math.max(...ROAD_WAYPOINTS.map(p => p.x));
  const top = Math.min(...ROAD_WAYPOINTS.map(p => p.y)), bottom = Math.max(...ROAD_WAYPOINTS.map(p => p.y));
  if (x < left - beyond || x > right + beyond || y < top - beyond || y > bottom + beyond) return Infinity;
  let best = Infinity;
  for (let index = 1; index < ROAD_WAYPOINTS.length; index++) {
    const a = ROAD_WAYPOINTS[index - 1], b = ROAD_WAYPOINTS[index];
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
    const px = a.x + t * dx - x, py = a.y + t * dy - y;
    best = Math.min(best, px * px + py * py);
  }
  return best;
}
/** Where the road ends, just west of the pines: the sign for Timberwood stands at the fork. */
export const GROVE_ROAD_END = ROAD_WAYPOINTS[ROAD_WAYPOINTS.length - 1];
export const GROVE_ROAD_FORK = ROAD_FORK;

/**
 * The rows the trees stand in: a row every ROW units, a tree every COLUMN along it, each next row shifted half a
 * column, so the tree in front of one is never straight in front and whoever stands at a tree's foot stays in view.
 * Trees keep their feet this far in from the grove's edges, the stands' sides and the road.
 */
const ROW = 200, COLUMN = 320, JITTER = { x: 28, y: 20 };
const GROVE_INSET = { west: 300, top: 300, bottom: 120, east: 200 }, STAND_INSET = 130, ROAD_CLEARANCE = 200;

function layGrove() {
  const trees: WoodTree[] = [];
  WOOD_STANDS.forEach((stand, standIndex) => {
    const last = standIndex === WOOD_STANDS.length - 1;
    const box = {
      left: stand.left + (standIndex === 0 ? GROVE_INSET.west : STAND_INSET), right: stand.right - (last ? GROVE_INSET.east : STAND_INSET),
      top: TOWN_GROVE.top + GROVE_INSET.top, bottom: TOWN_GROVE.bottom - GROVE_INSET.bottom,
    };
    const slots: Point[] = [];
    for (let row = 0, y = box.top; y <= box.bottom; row++, y += ROW) {
      for (let x = box.left + (row % 2) * COLUMN / 2, column = 0; x <= box.right; x += COLUMN, column++) {
        const random = townRandom(standIndex, row, column, 81);
        const at = { x: Math.round(x + (random() * 2 - 1) * JITTER.x), y: Math.round(y + (random() * 2 - 1) * JITTER.y) };
        if (groveRoadDistanceSquared(at.x, at.y, ROAD_CLEARANCE) < ROAD_CLEARANCE * ROAD_CLEARANCE) continue;
        slots.push(at);
      }
    }
    // Which slots stand: a seeded few are left as glades, so the rows read as a wood rather than an orchard.
    const random = townRandom(standIndex, 83);
    const order = slots.map(slot => ({ slot, key: random() })).sort((a, b) => a.key - b.key).slice(0, stand.trees).map(({ slot }) => slot);
    order.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const at of order) trees.push({ id: trees.length, x: at.x, y: at.y, kind: stand.kind, stand: standIndex, log: stand.log });
  });
  return trees;
}
/** Every tree in Timberwood, by id (its place in this list). */
export const WOOD_TREE_NODES: readonly WoodTree[] = Object.freeze(layGrove());

export const woodTree = (id: unknown): WoodTree | null =>
  typeof id === "number" && Number.isInteger(id) && id >= 0 ? WOOD_TREE_NODES[id] ?? null : null;

export function normalizeWoodcutting(woodcutting: unknown) {
  const value = Number(woodcutting);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** How much faster than a new woodcutter: 1× at Woodcutting 0, 2× at 500, closing in on 3×, as Mining. */
export function woodcuttingSpeed(woodcutting: unknown) {
  const value = normalizeWoodcutting(woodcutting);
  return 1 + 2 * value / (value + 500);
}

/** Seconds to fell a tree at this Woodcutting. */
export function woodcuttingChopSeconds(tree: WoodTree, woodcutting: unknown) {
  return WOODCUTTING_CHOP_SECONDS * WOOD_STANDS[tree.stand].hardness / woodcuttingSpeed(woodcutting);
}

/** What felling a tree adds to Woodcutting: its logs, weighted by its stand's hardness, so deeper stands teach faster. */
export function woodcuttingGain(tree: WoodTree) {
  return WOODCUTTING_LOGS * WOOD_STANDS[tree.stand].hardness;
}

/** What a felled tree gives: its stand's logs. */
export function woodcuttingYield(tree: WoodTree): Partial<Record<WoodId, number>> {
  return { [tree.log]: WOODCUTTING_LOGS };
}

/** Whether a stand is open: pine always, the rest once the map whose gear their wood crafts is unlocked. */
export function woodStandOpen(stand: WoodStand, access: CampaignAccess | null | undefined) {
  return stand.firstTier <= 1 || Boolean(access && campaignMapUnlocked(stand.firstTier - 1, access));
}

/** The map that opens a stand ("Reach Night Forest - 5 to chop Oak Trees"). */
export function woodStandMap(stand: WoodStand) {
  const mapId = MAP_IDS[stand.firstTier - 1];
  return (mapId && MAP_DISPLAY_NAMES[mapId as keyof typeof MAP_DISPLAY_NAMES]) || `Map ${stand.firstTier}`;
}

/** "Reach Night Forest - 5 to chop Oak Trees." */
export const woodStandHint = (stand: WoodStand) => `Reach ${woodStandMap(stand)} to chop ${stand.name}s.`;
