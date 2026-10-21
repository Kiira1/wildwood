import type { WoodId } from "./crafting";
import { toolSpeed } from "./tools";
import { TOWN_GROVE, TOWN_WEST_BRIDGE, townRandom } from "./town";

/**
 * Woodcutting, in Timberwood west of the village (TOWN_GROVE): walk up to a tree with your hatchet and you chop
 * it, as you mine a rock, and it falls into logs for crafting. Peaceful, as the hills are.
 *
 * - Four stands, east to west: pine nearest the village, then oak, yew and elder, each opening at a Woodcutting
 *   level (canChopTree), on the same scale as the ore veins' Mining (shared/mining.ts).
 * - Every tree raises the Woodcutting stat, which makes chopping faster. Prestige never resets it.
 * - Each player has their own trees: a felled tree is a stump for them alone until it grows back.
 *
 * The trees are laid from their coordinates alone, the same for every client and the server: in loose clumps, so
 * whoever chops one stands in view, with no spot in reach of two.
 */

export type WoodTreeKind = "pine" | "oak" | "yew" | "elder";
export const WOOD_TREE_KINDS: readonly WoodTreeKind[] = Object.freeze(["pine", "oak", "yew", "elder"]);

export type WoodStand = {
  kind: WoodTreeKind;
  /** "Pine Tree": what its trees are called. */
  name: string;
  log: WoodId;
  /** The first gear tier its wood crafts. */
  firstTier: number;
  /** The Woodcutting its trees ask for (shared/tools.ts gates the hatchet on the same scale). */
  woodcutting: number;
  /** How much longer its trees take to fell than pine's: twice as long a grade. */
  hardness: number;
  /** How many trees it holds: the deeper the stand, the scarcer. */
  trees: number;
  /** The band of the grove it fills. */
  left: number;
  right: number;
};
/** A band of the grove, measured west from its east edge (the village's side). */
const band = (from: number, to: number) => ({ left: TOWN_GROVE.right - to, right: TOWN_GROVE.right - from });
export const WOOD_STANDS: readonly WoodStand[] = Object.freeze([
  { kind: "pine", name: "Pine Tree", log: "pine_log", firstTier: 1, woodcutting: 0, hardness: 1, trees: 16, ...band(0, 700) },
  { kind: "oak", name: "Oak Tree", log: "oak_log", firstTier: 5, woodcutting: 50, hardness: 2, trees: 14, ...band(700, 1_300) },
  { kind: "yew", name: "Yew Tree", log: "yew_log", firstTier: 9, woodcutting: 250, hardness: 4, trees: 12, ...band(1_300, 1_880) },
  { kind: "elder", name: "Elder Tree", log: "elder_log", firstTier: 13, woodcutting: 900, hardness: 8, trees: 10, ...band(1_880, 2_550) },
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
 * The woodcutters' road: out of the village over its west bridge, west across the countryside into the grove, then
 * winding on through the pines and the oaks to peter out at the yews. Its centre line, a point every few units, bent
 * smoothly through its waypoints; the trees keep off it.
 */
const bridge = (dx: number, dy: number): Point => ({ x: TOWN_WEST_BRIDGE.x + dx, y: TOWN_WEST_BRIDGE.y + dy });
/** A point in the grove, measured west from its east edge and down from the bridge's middle. */
const grove = (dx: number, dy: number): Point => ({ x: TOWN_GROVE.right - dx, y: TOWN_WEST_BRIDGE.y + dy });
/** Where the road starts, on the bridge's deck (its earth runs on under the deck's west half), and where it comes into the grove. */
const ROAD_START = bridge(-110, 0);
const ROAD_GATE = grove(60, -66);
const ROAD_WAYPOINTS: readonly Point[] = [
  ROAD_START, bridge(-180, -6), bridge(-300, -42), bridge(-500, -58), bridge(-800, -66), ROAD_GATE,
  grove(360, 4), grove(700, -106), grove(1_020, -26), grove(1_300, -116), grove(1_480, -66),
];
/** A smooth line through the waypoints (Catmull-Rom), a point about every `step` units. */
function smoothLine(points: readonly Point[], step: number): Point[] {
  const line: Point[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    const p0 = points[Math.max(0, index - 1)], p1 = points[index], p2 = points[index + 1], p3 = points[Math.min(points.length - 1, index + 2)];
    const steps = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const at = (a: number, b: number, c: number, d: number) => .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      line.push({ x: Math.round(at(p0.x, p1.x, p2.x, p3.x)), y: Math.round(at(p0.y, p1.y, p2.y, p3.y)) });
    }
  }
  line.push(points[points.length - 1]);
  return line;
}
export const GROVE_ROAD: readonly Point[] = Object.freeze(smoothLine(ROAD_WAYPOINTS, 40));
/** Half the road's width: a little narrower than the miners' track. */
export const GROVE_ROAD_HALF_WIDTH = 36;
/** The road ends in a round landing of bare earth, this far across from its end, where felled logs are stacked. */
export const GROVE_LANDING_RADIUS = 100;
const ROAD_BOX = {
  left: Math.min(...GROVE_ROAD.map(p => p.x)), right: Math.max(...GROVE_ROAD.map(p => p.x)),
  top: Math.min(...GROVE_ROAD.map(p => p.y)), bottom: Math.max(...GROVE_ROAD.map(p => p.y)),
};
/** How far a point is from the road's centre line, squared; anything further than `beyond` from its box is Infinity. */
export function groveRoadDistanceSquared(x: number, y: number, beyond = Infinity) {
  if (x < ROAD_BOX.left - beyond || x > ROAD_BOX.right + beyond || y < ROAD_BOX.top - beyond || y > ROAD_BOX.bottom + beyond) return Infinity;
  let best = Infinity;
  for (let index = 1; index < GROVE_ROAD.length; index++) {
    const a = GROVE_ROAD[index - 1], b = GROVE_ROAD[index];
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
    const px = a.x + t * dx - x, py = a.y + t * dy - y;
    best = Math.min(best, px * px + py * py);
  }
  return best;
}
/** Where the road ends, among the first yews; where it comes into the grove; and where it leaves the village, the sign for Timberwood beside it. */
export const GROVE_ROAD_END = ROAD_WAYPOINTS[ROAD_WAYPOINTS.length - 1];
export const GROVE_ROAD_GATE = ROAD_GATE;
export const GROVE_ROAD_START = ROAD_START;

/**
 * How far each kind's trees reach round their foot as drawn (town-world.ts picks the pack's trees): at most this
 * far either side, and this high. The layout keeps whoever chops a tree from standing behind another.
 */
export const WOOD_TREE_SPREAD: Readonly<Record<WoodTreeKind, { half: number; up: number }>> = Object.freeze({
  pine: { half: 64, up: 216 }, oak: { half: 92, up: 230 }, yew: { half: 76, up: 292 }, elder: { half: 130, up: 262 },
});
/** Where feet stand to chop a tree, from its foot: either side, or in front. */
export const WOOD_TREE_SPOTS: readonly Point[] = Object.freeze([{ x: -50, y: 20 }, { x: 50, y: 20 }, { x: 0, y: 44 }]);
/** How far into its neighbours' bands a stand's trees may stray, so the kinds mingle where two stands meet. */
export const WOOD_STAND_BLEND = 140;
/** Trees keep their feet at least this far apart (no spot in reach of two), and this far off the road's centre. */
const TREE_GAP = 2 * WOODCUTTING_REACH + 40, ROAD_CLEARANCE = 165;
/** How far in from the grove's edges trees keep their feet: the north and west rows stand back from the walls. */
const GROVE_INSET = { west: 260, top: 220, bottom: 150, east: 180 };

/** Whether a tree's crown, up from its foot, comes over the road (and someone walking it). */
function crownOverRoad(x: number, y: number, spread: { half: number; up: number }) {
  const clear = GROVE_ROAD_HALF_WIDTH + spread.half * .5;
  for (let up = 0; up <= spread.up; up += 30) if (groveRoadDistanceSquared(x, y - up, clear) < clear * clear) return true;
  return false;
}
/** Whether feet at a spot are in reach of this tree alone, and in front of every tree they would stand behind. */
function spotClear(trees: readonly (Point & { kind: WoodTreeKind })[], own: number, feet: Point) {
  return trees.every((tree, index) => {
    if (index !== own && Math.hypot(tree.x - feet.x, tree.y - feet.y) <= WOODCUTTING_REACH) return false;
    const spread = WOOD_TREE_SPREAD[tree.kind];
    return !(tree.y > feet.y && tree.y - spread.up < feet.y && Math.abs(tree.x - feet.x) < spread.half + 22);
  });
}
const choppable = (trees: readonly (Point & { kind: WoodTreeKind })[], index: number) =>
  WOOD_TREE_SPOTS.some(spot => spotClear(trees, index, { x: trees[index].x + spot.x, y: trees[index].y + spot.y }));

/**
 * The stands, east to west, each in loose clumps of a few trees round seeded centres with a straggler or two
 * between, never in rows. A stand strays a little into its neighbours' bands, so oaks stand among the last pines.
 * Each tree is kept only where it leaves every tree near it a spot to chop from, in plain view.
 */
function layGrove() {
  const placed: (Point & { kind: WoodTreeKind; stand: number })[] = [];
  const top = TOWN_GROVE.top + GROVE_INSET.top, bottom = TOWN_GROVE.bottom - GROVE_INSET.bottom;
  // The clumps' middles lie on a jittered grid, this many rows from north to south.
  const rows = Math.max(2, Math.round((bottom - top) / 700));
  WOOD_STANDS.forEach((stand, standIndex) => {
    const left = stand.left === TOWN_GROVE.left ? TOWN_GROVE.left + GROVE_INSET.west : stand.left - WOOD_STAND_BLEND;
    const right = stand.right === TOWN_GROVE.right ? TOWN_GROVE.right - GROVE_INSET.east : stand.right + WOOD_STAND_BLEND;
    const random = townRandom(standIndex, 97);
    const between = (from: number, to: number) => from + random() * (to - from);
    const count = Math.max(4, Math.round(stand.trees / 3)), columns = Math.ceil(count / rows);
    const from = Math.max(left, stand.left + 60), width = (Math.min(right, stand.right - 60) - from) / columns, height = (bottom - top) / rows;
    const clumps = Array.from({ length: count }, (_, index) => ({
      x: from + (Math.floor(index / rows) + between(.15, .85)) * width, y: top + (index % rows + between(.2, .8)) * height, reach: between(140, 250),
    }));
    let laid = 0;
    for (let attempt = 0; laid < stand.trees && attempt < 6_000; attempt++) {
      let x: number, y: number;
      if (random() < .18) { x = between(left, right); y = between(top, bottom); }
      else {
        const clump = clumps[Math.floor(random() * clumps.length)], angle = random() * Math.PI * 2, distance = clump.reach * Math.sqrt(random());
        x = clump.x + Math.cos(angle) * distance; y = clump.y + Math.sin(angle) * distance;
      }
      x = Math.round(x); y = Math.round(y);
      const spread = WOOD_TREE_SPREAD[stand.kind];
      if (x < left || x > right || y < top || y > bottom) continue;
      if (x - spread.half <= TOWN_GROVE.left || x + spread.half >= TOWN_GROVE.right) continue;
      if (placed.some(tree => Math.hypot(tree.x - x, tree.y - y) < TREE_GAP)) continue;
      if (groveRoadDistanceSquared(x, y, ROAD_CLEARANCE) < ROAD_CLEARANCE * ROAD_CLEARANCE) continue;
      // Nor does its crown hang over the road, so whoever walks it stays in view.
      if (crownOverRoad(x, y, spread)) continue;
      const trial = [...placed, { x, y, kind: stand.kind, stand: standIndex }];
      const near = trial.map((_tree, index) => index).filter(index => Math.abs(trial[index].x - x) < 400 && Math.abs(trial[index].y - y) < 400);
      if (!near.every(index => choppable(trial, index))) continue;
      placed.push(trial[trial.length - 1]);
      laid++;
    }
  });
  // By stand, then north to south: a tree's id is its place in that order.
  const trees: WoodTree[] = [];
  WOOD_STANDS.forEach((stand, standIndex) => {
    for (const at of placed.filter(tree => tree.stand === standIndex).sort((a, b) => a.y - b.y || a.x - b.x)) {
      trees.push({ id: trees.length, x: at.x, y: at.y, kind: stand.kind, stand: standIndex, log: stand.log });
    }
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

/** Seconds to fell a tree at this Woodcutting, faster with the hatchet's upgrades (shared/tools.ts) and Chop Speed cards (a fraction). */
export function woodcuttingChopSeconds(tree: WoodTree, woodcutting: unknown, hatchetLevel = 0, cardSpeed = 0) {
  return WOODCUTTING_CHOP_SECONDS * WOOD_STANDS[tree.stand].hardness
    / (woodcuttingSpeed(woodcutting) * (1 + Math.max(0, cardSpeed)) * toolSpeed(hatchetLevel));
}

/** What felling a tree adds to Woodcutting: its logs, weighted by its stand's hardness, so deeper stands teach faster. */
export function woodcuttingGain(tree: WoodTree) {
  return WOODCUTTING_LOGS * WOOD_STANDS[tree.stand].hardness;
}

/**
 * What a felled tree gives: its stand's logs, and one more when the hatchet's `bonus` comes up. A Log Find card's
 * chance (`extraRoll` in [0, 1) against it) adds one more.
 */
export function woodcuttingYield(tree: WoodTree, bonus = 0, logFind = 0, extraRoll = 1): Partial<Record<WoodId, number>> {
  return { [tree.log]: WOODCUTTING_LOGS + bonus + (extraRoll < logFind ? 1 : 0) };
}

/** Whether this Woodcutting opens a stand. */
export const canChopStand = (stand: Pick<WoodStand, "woodcutting">, woodcutting: unknown) => normalizeWoodcutting(woodcutting) >= stand.woodcutting;

/** Whether this Woodcutting may chop a tree: the one gate the server, the runtime and Auto Chop all check. */
export const canChopTree = (tree: Pick<WoodTree, "stand">, woodcutting: unknown) => canChopStand(WOOD_STANDS[tree.stand], woodcutting);

/** "Reach Woodcutting 50 to chop Oak Trees." */
export const woodStandHint = (stand: WoodStand) => `Reach Woodcutting ${stand.woodcutting.toLocaleString("en-US")} to chop ${stand.name}s.`;
