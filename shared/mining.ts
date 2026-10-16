import { campaignMapUnlocked, type CampaignAccess } from "./equipment-access";
import { REFINE_ORES, type OreId } from "./refine";
import { luckMultiplier } from "./luck-research";
import { MAP_DISPLAY_NAMES, MAP_IDS } from "./rules";
import { TOWN_EAST_BRIDGE, TOWN_EAST_FENCE_GAP, TOWN_HILLS, townRandom } from "./town";

/**
 * Mining, in the Copper Hills east of the Town (TOWN_HILLS): walk up to an ore rock with a pickaxe and you mine it,
 * as you would attack, and it breaks into ore for the Smith's refines. Peaceful: no monsters, no dying.
 *
 * - Four veins, west to east: copper nearest the village, then iron, mithril and adamant, each opening with the map
 *   whose gear that ore refines (shared/refine.ts grades: tiers 1-4 copper, 5-8 iron, 9-12 mithril, 13-15 adamant).
 * - Rocks come Small, Large and, rarely, Mysterious; only a Mysterious rock can hold a Starshard.
 * - Every rock raises the Mining stat, which makes mining faster. Prestige never resets it.
 * - Each player has their own rocks: a broken rock is bare for them alone until it grows back.
 *
 * The rocks are laid from their coordinates alone, the same for every client and the server, as the Town's
 * countryside is: in outcrops of a few rocks, each on its own clearing, either side of a miners' track that runs in
 * from the village and ends at the deepest outcrop, with room by every rock to stand and mine it. The server rolls
 * every ore.
 */

/** The four grade ores: what a vein can hold. A Starshard comes only out of a Mysterious rock. */
export type VeinOreId = Exclude<OreId, "starshard">;

export type MiningVein = {
  ore: VeinOreId;
  /** The first gear tier this ore refines: its vein opens with that tier's map. */
  firstTier: number;
  /** The band of the hills it fills, west to east. */
  left: number;
  right: number;
  /** How much longer its rocks take to break than copper's: twice as long a grade. */
  hardness: number;
  /** How many rocks it holds: the deeper the vein, the scarcer. */
  rocks: number;
};
const band = (from: number, to: number) => ({ left: TOWN_HILLS.left + from, right: TOWN_HILLS.left + to });
export const MINING_VEINS: readonly MiningVein[] = Object.freeze([
  { ore: "copper_ore", firstTier: 1, hardness: 1, rocks: 34, ...band(0, 1_400) },
  { ore: "iron_ore", firstTier: 5, hardness: 2, rocks: 26, ...band(1_400, 2_500) },
  { ore: "mithril_ore", firstTier: 9, hardness: 4, rocks: 22, ...band(2_500, 3_500) },
  { ore: "adamant_ore", firstTier: 13, hardness: 8, rocks: 18, ...band(3_500, 4_400) },
] as const);

export type MiningNodeKind = "small" | "large" | "mysterious";
/**
 * Each kind of rock: how long a new miner takes to break one of copper (a vein's hardness multiplies it, Mining
 * divides it), the ore it breaks into, how long it stays bare for the player who broke it, and its share of a
 * vein's rocks (Small takes the rest; every vein has at least one Mysterious).
 */
export const MINING_NODE_KINDS: Readonly<Record<MiningNodeKind, { name: string; breakSeconds: number; ore: number; respawnSeconds: number; share: number }>> = {
  small: { name: "Small", breakSeconds: 4, ore: 1, respawnSeconds: 60, share: 0 },
  large: { name: "Large", breakSeconds: 12, ore: 3, respawnSeconds: 180, share: .24 },
  mysterious: { name: "Mysterious", breakSeconds: 12, ore: 2, respawnSeconds: 900, share: .04 },
};
/** A Mysterious rock's chance of a Starshard beside its ore: the ore every refine from ★11 on takes. */
export const MINING_STARSHARD_CHANCE = .15;

/** How close a player's feet come to a rock's foot to mine it, and the server's allowance on top for lag. */
export const MINING_REACH = 70;
export const MINING_SERVER_REACH = 120;
/** The server takes a break this soon at the earliest, as a share of the rock's time: clocks and packets wander. */
export const MINING_RATE_SLACK = .75;

export type MiningNode = { id: number; x: number; y: number; kind: MiningNodeKind; vein: number; ore: VeinOreId };

// ---- How the hills are laid ----
// Everything here is plain arithmetic on whole numbers and townRandom (no trigonometry, whose last digit an engine
// may round its own way), so every client and the server lay the very same rocks.

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
export const MINING_ROCK_ROOM: Readonly<Record<MiningNodeKind, number>> = { small: 76, large: 92, mysterious: 92 };
/**
 * How far each kind's stone reaches from its foot, at most, either way round (town-world.ts picks the stone and
 * its size): half its width, its height above its foot and how far below its foot it shows.
 */
export const MINING_ROCK_EXTENT: Readonly<Record<MiningNodeKind, { half: number; up: number; down: number }>> = {
  small: { half: 41, up: 52, down: 18 }, large: { half: 64, up: 80, down: 23 }, mysterious: { half: 54, up: 80, down: 23 },
};
/**
 * The room below each rock where the plate that names it hangs while it is mined (ore-rock-renderer.ts): just past
 * the reach, so it is never on whoever mines it, whose feet come no lower; and no other rock stands in it, so it is
 * never on one of those either. As big as the plate is at the default zoom on a desktop or a phone (a Mysterious
 * rock's name is the longest), from the rock's foot.
 */
export const MINING_PLATE_ROOM = Object.freeze({ half: { small: 80, large: 100, mysterious: 100 } as Readonly<Record<MiningNodeKind, number>>, top: MINING_REACH + 4, bottom: MINING_REACH + 66 });
/** Whether a rock of kind `kind` at (x, y) would stand in the plate room of a rock of kind `under` at (ux, uy). */
const inPlateRoom = (ux: number, uy: number, under: MiningNodeKind, x: number, y: number, kind: MiningNodeKind) => {
  const extent = MINING_ROCK_EXTENT[kind];
  return Math.abs(x - ux) < MINING_PLATE_ROOM.half[under] + extent.half
    && y - extent.up < uy + MINING_PLATE_ROOM.bottom && y + extent.down > uy + MINING_PLATE_ROOM.top;
};

/** About how many rocks an outcrop holds. */
const OUTCROP_ROCKS = 5.5;
/** Rocks of two different outcrops stand at least this far apart: their clearings keep grass between them. */
export const MINING_OUTCROP_GAP = 340;
/**
 * How far in from the hills' edges and a vein's sides the rocks keep their feet: room for the trees that frame
 * the hills and the hedges between the veins, and a wider way in from the west.
 */
const HILLS_INSET = { west: 330, north: 230, south: 260, east: 240 }, VEIN_INSET = 175;
/**
 * Rocks keep their feet this far from the track's centre line, so their clearings keep grass between them and
 * the track; but the outcrop the track ends at (PINNED_OUTCROPS) stands round its end, its rocks only just off it.
 * Every rock keeps its top off the track too.
 */
const TRACK_FOOT_CLEARANCE = 220, TRACK_END_CLEARANCE = MINING_TRACK_HALF_WIDTH + 72, TRACK_TOP_CLEARANCE = MINING_TRACK_HALF_WIDTH + 26;
const TRACK_END = TRACK_WAYPOINTS[TRACK_WAYPOINTS.length - 1];
/**
 * Two outcrops are set rather than sought: the first copper one just inside the way in, below the track, the
 * first thing a newcomer sees; and the last adamant one where the track ends, so the track leads to it.
 */
const PINNED_OUTCROPS: Readonly<Record<number, Point>> = { 0: hills(560, 990), [MINING_VEINS.length - 1]: { x: TRACK_END.x + 170, y: TRACK_END.y } };

/** A seeded direction: an even spread of unit vectors without trigonometry. */
function direction(random: () => number) {
  for (;;) {
    const x = random() * 2 - 1, y = random() * 2 - 1, length = x * x + y * y;
    if (length > .04 && length <= 1) { const scale = 1 / Math.sqrt(length); return { x: x * scale, y: y * scale }; }
  }
}

function layHills() {
  const nodes: MiningNode[] = [];
  /** Which outcrop each rock stands in, by id. */
  const outcropOf: number[] = [];
  const outcrops: { id: number; vein: number; x: number; y: number; reach: number; rocks: number[]; axis: Point; stretch: number }[] = [];
  /** The outcrop the track ends at, once it is laid. */
  let trackEnd = -1;
  const fits = (x: number, y: number, kind: MiningNodeKind, outcrop: number, box: { left: number; right: number; top: number; bottom: number }) => {
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return false;
    const clearance = outcrop === trackEnd ? TRACK_END_CLEARANCE : TRACK_FOOT_CLEARANCE;
    if (miningTrackDistanceSquared(x, y, clearance) < clearance * clearance) return false;
    if (miningTrackDistanceSquared(x, y - MINING_ROCK_EXTENT[kind].up, TRACK_TOP_CLEARANCE) < TRACK_TOP_CLEARANCE * TRACK_TOP_CLEARANCE) return false;
    return nodes.every(node => {
      const room = outcropOf[node.id] === outcrop ? MINING_ROCK_ROOM[node.kind] + MINING_ROCK_ROOM[kind] : MINING_OUTCROP_GAP;
      const dx = node.x - x, dy = node.y - y;
      return dx * dx + dy * dy >= room * room && !inPlateRoom(node.x, node.y, node.kind, x, y, kind) && !inPlateRoom(x, y, kind, node.x, node.y, node.kind);
    });
  };
  MINING_VEINS.forEach((vein, veinIndex) => {
    const last = veinIndex === MINING_VEINS.length - 1;
    const box = {
      left: vein.left + (veinIndex === 0 ? HILLS_INSET.west : VEIN_INSET), right: vein.right - (last ? HILLS_INSET.east : VEIN_INSET),
      top: TOWN_HILLS.top + HILLS_INSET.north, bottom: TOWN_HILLS.bottom - HILLS_INSET.south,
    };
    // Kinds by share rather than by dice, so every vein has its Large rocks and its Mysterious one.
    const mysterious = Math.max(1, Math.round(vein.rocks * MINING_NODE_KINDS.mysterious.share));
    const large = Math.round(vein.rocks * MINING_NODE_KINDS.large.share);
    // Outcrop sizes: an even share each, then a few rocks moved between them so they differ (3 to 7 each, a rock or so
    // more where one before had no room for all of its own).
    const count = Math.max(1, Math.round(vein.rocks / OUTCROP_ROCKS));
    const sizes = Array.from({ length: count }, (_, index) => Math.floor(vein.rocks / count) + (index < vein.rocks % count ? 1 : 0));
    const shuffle = townRandom(veinIndex, 41);
    for (let move = 0; move < count; move++) {
      const from = Math.floor(shuffle() * count), to = Math.floor(shuffle() * count);
      if (from !== to && sizes[from] > 3 && sizes[to] < 7) { sizes[from]--; sizes[to]++; }
    }
    sizes.sort((a, b) => b - a);
    // A big rock at every outcrop's heart (Large for now: the Mysterious ones are chosen once all stand), and any
    // big rocks over beside the hearts of the biggest outcrops.
    const kindsOf = sizes.map(size => Array.from({ length: size }, (_, rank): MiningNodeKind => (rank === 0 ? "large" : "small")));
    let spare = mysterious + large - count;
    for (let index = count - 1; spare < 0 && index >= 0; index--, spare++) kindsOf[index][0] = "small";
    for (let rank = 1; spare > 0 && rank < 8; rank++) for (const kinds of kindsOf) if (spare > 0 && rank < kinds.length) { kinds[rank] = "large"; spare--; }
    // An outcrop's rocks: its heart at (or as near as fits to) its middle, then each next rock beside one already
    // laid, a room's width on, at the free spot nearest the middle along the outcrop's lie.
    const place = (outcrop: (typeof outcrops)[number], kind: MiningNodeKind, attempt: number) => {
      const random = townRandom(outcrop.id, attempt, 47);
      const candidates: Point[] = [];
      if (!outcrop.rocks.length) {
        candidates.push(outcrop);
        for (let ring = 1; ring <= 8; ring++) for (let k = 0; k < 10; k++) {
          const way = direction(random);
          candidates.push({ x: outcrop.x + way.x * ring * 24, y: outcrop.y + way.y * ring * 24 });
        }
      } else {
        for (const id of outcrop.rocks) {
          const rock = nodes[id];
          for (let k = 0; k < 14; k++) {
            const way = direction(random), distance = MINING_ROCK_ROOM[rock.kind] + MINING_ROCK_ROOM[kind] + 4 + random() * 30;
            candidates.push({ x: rock.x + way.x * distance, y: rock.y + way.y * distance });
          }
        }
      }
      let best: Point | null = null, bestScore = Infinity;
      for (const candidate of candidates) {
        const x = Math.round(candidate.x), y = Math.round(candidate.y);
        if (!fits(x, y, kind, outcrop.id, box)) continue;
        const dx = x - outcrop.x, dy = y - outcrop.y;
        const along = (dx * outcrop.axis.x + dy * outcrop.axis.y) / outcrop.stretch, across = dx * outcrop.axis.y - dy * outcrop.axis.x;
        const score = along * along + across * across;
        if (score < bestScore) { best = { x, y }; bestScore = score; }
      }
      if (!best) return false;
      outcrop.rocks.push(nodes.length);
      outcropOf.push(outcrop.id);
      nodes.push({ id: nodes.length, x: best.x, y: best.y, kind, vein: veinIndex, ore: vein.ore });
      return true;
    };
    // One outcrop at a time, so each next one's middle is sought among the rocks already standing: a pinned one's
    // where it is set, any other's at the first of the best few seeded tries (as far as can be from those rocks
    // and the vein's sides, and off the track) where all its rocks fit. Failing that, where most of them do, and
    // the rest go on to the next outcrop.
    const veinOutcrops: (typeof outcrops)[number][] = [];
    let carried: MiningNodeKind[] = [];
    kindsOf.forEach((kinds, index) => {
      const want = [...kinds, ...carried];
      carried = [];
      const random = townRandom(veinIndex, index, 43);
      const reach = 64 * Math.sqrt(want.length) + 46;
      const pinned = index === 0 ? PINNED_OUTCROPS[veinIndex] : undefined;
      const tries: { x: number; y: number; score: number }[] = [];
      for (let attempt = 0; attempt < 120 && !pinned; attempt++) {
        const x = box.left + random() * (box.right - box.left), y = box.top + random() * (box.bottom - box.top);
        let score = Math.min(x - box.left, box.right - x, y - box.top, box.bottom - y) - reach * .5;
        score = Math.min(score, Math.sqrt(miningTrackDistanceSquared(x, y)) - TRACK_FOOT_CLEARANCE - reach * .5);
        for (const node of nodes) {
          const dx = node.x - x, dy = node.y - y;
          score = Math.min(score, Math.sqrt(dx * dx + dy * dy) - MINING_OUTCROP_GAP - reach * .7);
        }
        tries.push({ x, y, score });
      }
      const middles = pinned ? [pinned] : tries.sort((a, b) => b.score - a.score).slice(0, 40);
      const axis = direction(random), stretch = 1 + random() * .7;
      const lay = (middle: Point) => {
        const outcrop = { id: outcrops.length, vein: veinIndex, x: Math.round(middle.x), y: Math.round(middle.y), reach, rocks: [] as number[], axis, stretch };
        if (pinned && last) trackEnd = outcrop.id;
        const failed = want.filter((kind, rank) => !place(outcrop, kind, rank));
        return { outcrop, failed };
      };
      const undo = (laid: number) => { nodes.length = laid; outcropOf.length = laid; };
      const laid = nodes.length;
      let best: { middle: Point; failed: number } | null = null;
      for (const middle of middles) {
        const attempt = lay(middle);
        if (!best || attempt.failed.length < best.failed) best = { middle, failed: attempt.failed.length };
        undo(laid);
        if (!attempt.failed.length) break;
      }
      const { outcrop, failed } = lay(best!.middle);
      outcrops.push(outcrop);
      veinOutcrops.push(outcrop);
      carried = failed;
    });
    for (const [index, kind] of carried.entries()) veinOutcrops.some(outcrop => outcrop.rocks.length > 0 && place(outcrop, kind, 100 + index));
    // The Mysterious rocks: the hearts of the outcrops furthest off the track.
    const quiet = (outcrop: (typeof outcrops)[number]) => miningTrackDistanceSquared(outcrop.x, outcrop.y);
    veinOutcrops.filter(outcrop => outcrop.rocks.length && nodes[outcrop.rocks[0]].kind === "large")
      .sort((a, b) => quiet(b) - quiet(a)).slice(0, mysterious)
      .forEach(outcrop => { nodes[outcrop.rocks[0]].kind = "mysterious"; });
  });
  return {
    nodes,
    outcrops: outcrops.filter(outcrop => outcrop.rocks.length).map(({ id, vein, x, y, rocks }) => Object.freeze({ id, vein, x, y, rocks: Object.freeze(rocks) })),
  };
}
const LAID = layHills();
/** Every rock in the hills, by id (its place in this list). */
export const MINING_NODES: readonly MiningNode[] = Object.freeze(LAID.nodes);
/** The outcrops the rocks stand in, each with its rocks' ids. */
export const MINING_OUTCROPS: readonly MiningOutcrop[] = Object.freeze(LAID.outcrops);

export const miningNode = (id: unknown): MiningNode | null =>
  typeof id === "number" && Number.isInteger(id) && id >= 0 ? MINING_NODES[id] ?? null : null;

/** "Large Iron Ore": a rock's name. */
export const miningNodeName = (node: MiningNode) => `${MINING_NODE_KINDS[node.kind].name} ${REFINE_ORES[node.ore].name}`;

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
/** `cardSpeed` is what Mining Speed cards add, a fraction. */
export function miningBreakSeconds(node: MiningNode, mining: unknown, cardSpeed = 0) {
  return MINING_NODE_KINDS[node.kind].breakSeconds * MINING_VEINS[node.vein].hardness / (miningSpeed(mining) * (1 + Math.max(0, cardSpeed)));
}

/** What breaking a rock adds to Mining: its ore, weighted by its vein's hardness, so deeper veins teach faster. */
export function miningGain(node: MiningNode) {
  return MINING_NODE_KINDS[node.kind].ore * MINING_VEINS[node.vein].hardness;
}

/**
 * What a broken rock gives: its vein's ore, and from a Mysterious rock perhaps a Starshard. `roll` is in [0, 1).
 * Cards: Starshard cards raise its chance, and an Ore Find card's chance (`extraRoll` against it) adds one more ore.
 */
export function miningYield(node: MiningNode, roll: number, cards: { starshardFind?: number; oreFind?: number } = {}, extraRoll = 1, miningLuckRank = 0) {
  const ores: Partial<Record<OreId, number>> = { [node.ore]: MINING_NODE_KINDS[node.kind].ore + (extraRoll < (cards.oreFind ?? 0) ? 1 : 0) };
  // Starshard cards and Mining Luck each raise the chance.
  const starshard = MINING_STARSHARD_CHANCE * (1 + Math.max(0, cards.starshardFind ?? 0)) * luckMultiplier("miningLuck", miningLuckRank);
  if (node.kind === "mysterious" && roll < starshard) ores.starshard = 1;
  return ores;
}

/** Whether a vein is open: copper always, the rest once the map whose gear their ore refines is unlocked. */
export function miningVeinOpen(vein: MiningVein, access: CampaignAccess | null | undefined) {
  return vein.firstTier <= 1 || Boolean(access && campaignMapUnlocked(vein.firstTier - 1, access));
}

/** The map that opens a vein ("Reach Lava Lake - 5 to mine Iron Ore"). */
export function miningVeinMap(vein: MiningVein) {
  const mapId = MAP_IDS[vein.firstTier - 1];
  return (mapId && MAP_DISPLAY_NAMES[mapId as keyof typeof MAP_DISPLAY_NAMES]) || `Map ${vein.firstTier}`;
}
