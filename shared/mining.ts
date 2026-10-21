import { REFINE_ORES, type GradeOreId, type OreId } from "./refine";
import { ARCANE_CRYSTAL } from "./crafting";
import { luckMultiplier } from "./luck-research";
import { toolSpeed } from "./tools";
import { MINING_LAYOUT_OUTCROPS, MINING_LAYOUT_ROCKS } from "./mining-layout.generated";
import { TOWN_EAST_BRIDGE, TOWN_EAST_FENCE_GAP, TOWN_HILLS } from "./town";

/**
 * Mining, in the Copper Hills east of the Town (TOWN_HILLS): walk up to an ore rock with a pickaxe and you mine it,
 * as you would attack, and it breaks into ore for the Smith's refines. Peaceful: no monsters, no dying.
 *
 * - Four veins, west to east: copper nearest the village, then iron, mithril and adamant, each opening at a Mining
 *   level (canMineRock), the ores for the gear tiers shared/refine.ts grades: 1-4 copper, 5-8 iron, 9-12 mithril, 13-15 adamant.
 * - Rocks come Small, Large and, rarely, Mysterious; only a Mysterious rock can hold a Starshard.
 * - A few crystal rocks in every vein hold Arcane Crystal for crafting instead of ore, at a little more Mining than the vein.
 * - Every rock raises the Mining stat, which makes mining faster. Prestige never resets it.
 * - Each player has their own rocks: a broken rock is bare for them alone until it grows back.
 *
 * The rocks are laid once, by shared/mining-layout-generate.ts, and every client and the server read the result
 * (shared/mining-layout.generated.ts): in outcrops of a few rocks, each on its own clearing, either side of a miners'
 * track that runs in from the village and ends at the deepest outcrop, with room by every rock to stand and mine it.
 * The server rolls every ore.
 */

/** The four grade ores: what a vein can hold. A Starshard comes only out of a Mysterious rock. */
export type VeinOreId = GradeOreId;
/** What a rock breaks into: its vein's ore, or a crystal rock's crystal. */
export type RockOreId = VeinOreId | typeof ARCANE_CRYSTAL;

export type MiningVein = {
  ore: VeinOreId;
  /** The first gear tier this ore refines. */
  firstTier: number;
  /** The Mining its ore rocks ask for, and its crystal rocks (shared/tools.ts gates the pickaxe on the same scale). */
  mining: number;
  crystalMining: number;
  /** The band of the hills it fills, west to east. */
  left: number;
  right: number;
  /** How much longer its rocks take to break than copper's: twice as long a grade. */
  hardness: number;
  /** How many rocks it holds: the deeper the vein, the scarcer. */
  rocks: number;
  /** How many crystal rocks stand among them. */
  crystals: number;
};
const band = (from: number, to: number) => ({ left: TOWN_HILLS.left + from, right: TOWN_HILLS.left + to });
export const MINING_VEINS: readonly MiningVein[] = Object.freeze([
  { ore: "copper_ore", firstTier: 1, mining: 0, crystalMining: 25, hardness: 1, rocks: 34, crystals: 3, ...band(0, 1_400) },
  { ore: "iron_ore", firstTier: 5, mining: 50, crystalMining: 75, hardness: 2, rocks: 26, crystals: 2, ...band(1_400, 2_500) },
  { ore: "mithril_ore", firstTier: 9, mining: 250, crystalMining: 300, hardness: 4, rocks: 22, crystals: 2, ...band(2_500, 3_500) },
  { ore: "adamant_ore", firstTier: 13, mining: 900, crystalMining: 1_000, hardness: 8, rocks: 18, crystals: 2, ...band(3_500, 4_400) },
] as const);

export type MiningNodeKind = "small" | "large" | "mysterious" | "crystal";
/**
 * Each kind of rock: how long a new miner takes to break one of copper (a vein's hardness multiplies it, Mining
 * divides it), the ore it breaks into, how long it stays bare for the player who broke it, and its share of a
 * vein's rocks (Small takes the rest; every vein has at least one Mysterious).
 */
export const MINING_NODE_KINDS: Readonly<Record<MiningNodeKind, { name: string; breakSeconds: number; ore: number; respawnSeconds: number; share: number }>> = {
  small: { name: "Small", breakSeconds: 4, ore: 1, respawnSeconds: 60, share: 0 },
  large: { name: "Large", breakSeconds: 12, ore: 3, respawnSeconds: 180, share: .24 },
  mysterious: { name: "Mysterious", breakSeconds: 12, ore: 2, respawnSeconds: 900, share: .04 },
  crystal: { name: "Crystal", breakSeconds: 10, ore: 1, respawnSeconds: 300, share: 0 },
};
/** A Mysterious rock always gives a Starshard beside its ore: the ore every refine from ★11 on takes. */
export const MINING_STARSHARD_CHANCE = 1;

/** How close a player's feet come to a rock's foot to mine it, and the server's allowance on top for lag. */
export const MINING_REACH = 70;
export const MINING_SERVER_REACH = 120;
/** The server takes a break this soon at the earliest, as a share of the rock's time: clocks and packets wander. */
export const MINING_RATE_SLACK = .75;

export type MiningNode = { id: number; x: number; y: number; kind: MiningNodeKind; vein: number; ore: RockOreId };

// ---- The miners' track ----
// Plain arithmetic on whole numbers (no trigonometry, whose last digit an engine may round its own way), so every
// client and the server lay the very same track.

type Point = { readonly x: number; readonly y: number };
const hills = (dx: number, dy: number): Point => ({ x: TOWN_HILLS.left + dx, y: TOWN_HILLS.top + dy });

const bridge = (dx: number, dy: number): Point => ({ x: TOWN_EAST_BRIDGE.x + dx, y: TOWN_EAST_BRIDGE.y + dy });
/**
 * The miners' track, laid as the village's own roads are (earth, rimmed): out of the gap in the village's fence,
 * up along the fence and over the east bridge, on to the hills, in through the gap in their trees, and on through
 * every vein to the last. Its centre line, a point every few units; the rocks keep off it. The rocks are laid from
 * the part in the hills alone (a test holds them where they are).
 */
const TRACK_WAYPOINTS: readonly Point[] = [
  { x: TOWN_EAST_FENCE_GAP.right + 30, y: (TOWN_EAST_FENCE_GAP.top + TOWN_EAST_FENCE_GAP.bottom) / 2 },
  bridge(-319, 224), bridge(-294, 59), bridge(-204, 4), bridge(-110, 0), bridge(110, 0), bridge(336, -21), bridge(636, -206),
  hills(-760, 608), hills(-60, 620), hills(500, 660), hills(1_000, 820), hills(1_500, 1_100),
  hills(2_000, 1_380), hills(2_550, 1_570), hills(3_150, 1_660), hills(3_700, 1_650),
];
/** Catmull-Rom through the waypoints: a smooth line, a point every `step` units or so. */
function smoothLine(points: readonly Point[], step: number): Point[] {
  const line: Point[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    const p0 = points[Math.max(0, index - 1)], p1 = points[index], p2 = points[index + 1], p3 = points[Math.min(points.length - 1, index + 2)];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const at = (a: number, b: number, c: number, d: number) => .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      line.push({ x: Math.round(at(p0.x, p1.x, p2.x, p3.x)), y: Math.round(at(p0.y, p1.y, p2.y, p3.y)) });
    }
  }
  line.push(points[points.length - 1]);
  return line;
}
export const MINING_TRACK: readonly Point[] = Object.freeze(smoothLine(TRACK_WAYPOINTS, 40));
/** Half the track's width, its rim aside: about the village's own roads. */
export const MINING_TRACK_HALF_WIDTH = 44;
const TRACK_BOX = {
  left: Math.min(...MINING_TRACK.map(point => point.x)), right: Math.max(...MINING_TRACK.map(point => point.x)),
  top: Math.min(...MINING_TRACK.map(point => point.y)), bottom: Math.max(...MINING_TRACK.map(point => point.y)),
};
/** How far a point is from the track's centre line, squared; anything further than `beyond` is just "far" (Infinity). */
export function miningTrackDistanceSquared(x: number, y: number, beyond = Infinity) {
  if (x < TRACK_BOX.left - beyond || x > TRACK_BOX.right + beyond || y < TRACK_BOX.top - beyond || y > TRACK_BOX.bottom + beyond) return Infinity;
  let best = Infinity;
  for (let index = 1; index < MINING_TRACK.length; index++) {
    const a = MINING_TRACK[index - 1], b = MINING_TRACK[index];
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
    const px = a.x + t * dx - x, py = a.y + t * dy - y;
    best = Math.min(best, px * px + py * py);
  }
  return best;
}

/**
 * The rocks stand in outcrops: a few round one big rock, each outcrop on its own clearing with grass between
 * (hills-ground.ts paints them). Each rock keeps its kind's room from every other, so two rocks never touch, a
 * player can stand by any of them, and no spot is within reach of two rocks (two rooms are more than twice
 * MINING_REACH).
 */
export type MiningOutcrop = { id: number; vein: number; x: number; y: number; rocks: readonly number[] };
export const MINING_ROCK_ROOM: Readonly<Record<MiningNodeKind, number>> = { small: 76, large: 92, mysterious: 92, crystal: 92 };
/**
 * How far each kind's stone reaches from its foot, at most, either way round (town-world.ts picks the stone and
 * its size): half its width, its height above its foot and how far below its foot it shows.
 */
export const MINING_ROCK_EXTENT: Readonly<Record<MiningNodeKind, { half: number; up: number; down: number }>> = {
  small: { half: 41, up: 52, down: 18 }, large: { half: 64, up: 80, down: 23 }, mysterious: { half: 54, up: 80, down: 23 }, crystal: { half: 64, up: 80, down: 23 },
};
/**
 * The room below each rock where the plate that names it hangs while it is mined (ore-rock-renderer.ts): just past
 * the reach, so it is never on whoever mines it, whose feet come no lower; and no other rock stands in it, so it is
 * never on one of those either. As big as the plate is at the default zoom on a desktop or a phone (a Mysterious
 * rock's name is the longest), from the rock's foot.
 */
export const MINING_PLATE_ROOM = Object.freeze({ half: { small: 80, large: 100, mysterious: 100, crystal: 100 } as Readonly<Record<MiningNodeKind, number>>, top: MINING_REACH + 4, bottom: MINING_REACH + 66 });

/** Rocks of two different outcrops stand at least this far apart: their clearings keep grass between them. */
export const MINING_OUTCROP_GAP = 340;

/** Every rock in the hills, by id (its place in this list). */
export const MINING_NODES: readonly MiningNode[] = Object.freeze(MINING_LAYOUT_ROCKS.map(([x, y, kind, vein], id): MiningNode =>
  ({ id, x, y, kind, vein, ore: kind === "crystal" ? ARCANE_CRYSTAL : MINING_VEINS[vein].ore })));
/** The outcrops the rocks stand in, each with its rocks' ids. */
export const MINING_OUTCROPS: readonly MiningOutcrop[] = Object.freeze(MINING_LAYOUT_OUTCROPS.map(([id, vein, x, y, rocks]) =>
  Object.freeze({ id, vein, x, y, rocks: Object.freeze(rocks) })));

export const miningNode = (id: unknown): MiningNode | null =>
  typeof id === "number" && Number.isInteger(id) && id >= 0 ? MINING_NODES[id] ?? null : null;

/** "Large Iron Ore": a rock's name. A crystal rock is named for its crystal alone. */
export const miningNodeName = (node: MiningNode) =>
  node.kind === "crystal" ? REFINE_ORES[node.ore].name : `${MINING_NODE_KINDS[node.kind].name} ${REFINE_ORES[node.ore].name}`;

export function normalizeMining(mining: unknown) {
  const value = Number(mining);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** How much faster than a new miner: 1× at Mining 0, 2× at 500, closing in on 3× and never past it. */
export function miningSpeed(mining: unknown) {
  const value = normalizeMining(mining);
  return 1 + 2 * value / (value + 500);
}

/** Seconds to break a rock at this Mining. */
/** `cardSpeed` is what Mining Speed cards add, a fraction; `pickaxeLevel` the pickaxe's upgrades (shared/tools.ts). */
export function miningBreakSeconds(node: MiningNode, mining: unknown, cardSpeed = 0, pickaxeLevel = 0) {
  return MINING_NODE_KINDS[node.kind].breakSeconds * MINING_VEINS[node.vein].hardness
    / (miningSpeed(mining) * (1 + Math.max(0, cardSpeed)) * toolSpeed(pickaxeLevel));
}

/** What breaking a rock adds to Mining: its ore, weighted by its vein's hardness, so deeper veins teach faster. */
export function miningGain(node: MiningNode) {
  return MINING_NODE_KINDS[node.kind].ore * MINING_VEINS[node.vein].hardness;
}

/** How much a rock breaks into before cards: a crystal rock's crystal grows with its vein's hardness, as its time does. */
export function miningRockOre(node: MiningNode) {
  return MINING_NODE_KINDS[node.kind].ore * (node.kind === "crystal" ? MINING_VEINS[node.vein].hardness : 1);
}

/**
 * What a broken rock gives: its vein's ore, and from a Mysterious rock a Starshard, perhaps two. `roll` is in [0, 1).
 * Cards: Starshard cards give a chance of a second, and an Ore Find card's chance (`extraRoll` against it) adds one more ore.
 * `toolBonus` is the pickaxe's extra ore, when its chance came up (shared/tools.ts).
 */
export function miningYield(node: MiningNode, roll: number, cards: { starshardFind?: number; oreFind?: number } = {}, extraRoll = 1, miningLuckRank = 0,
  toolBonus = 0) {
  const ores: Partial<Record<OreId, number>> = { [node.ore]: miningRockOre(node) + (extraRoll < (cards.oreFind ?? 0) ? 1 : 0) + toolBonus };
  // One is certain; Starshard cards and Mining Luck give their bonus as the chance of a second.
  const starshard = MINING_STARSHARD_CHANCE * (1 + Math.max(0, cards.starshardFind ?? 0)) * luckMultiplier("miningLuck", miningLuckRank);
  if (node.kind === "mysterious") ores.starshard = Math.floor(starshard) + (roll < starshard % 1 ? 1 : 0);
  return ores;
}

/** The Mining a rock asks for: its vein's, or a crystal rock's a little more. */
export const miningRockNeed = (node: Pick<MiningNode, "kind" | "vein">) =>
  node.kind === "crystal" ? MINING_VEINS[node.vein].crystalMining : MINING_VEINS[node.vein].mining;

/** Whether this Mining may mine a rock: the one gate the server, the runtime and Auto Mine all check. */
export const canMineRock = (node: Pick<MiningNode, "kind" | "vein">, mining: unknown) => normalizeMining(mining) >= miningRockNeed(node);

/** Why a rock cannot be mined yet: "Reach Mining 250 to mine Mithril Ore." */
export const miningRockHint = (node: Pick<MiningNode, "kind" | "vein" | "ore">) =>
  `Reach Mining ${miningRockNeed(node).toLocaleString("en-US")} to mine ${REFINE_ORES[node.ore].name}.`;
