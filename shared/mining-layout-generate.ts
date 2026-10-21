import { ARCANE_CRYSTAL } from "./crafting";
import {
  MINING_NODE_KINDS, MINING_OUTCROP_GAP, MINING_PLATE_ROOM, MINING_ROCK_EXTENT, MINING_ROCK_ROOM, MINING_TRACK, MINING_TRACK_HALF_WIDTH,
  MINING_VEINS, miningTrackDistanceSquared, type MiningNode, type MiningNodeKind, type RockOreId,
} from "./mining";
import { TOWN_HILLS, townRandom } from "./town";

/**
 * How the Copper Hills' rocks are laid. Only `npm run generate:mining-layout` and its guard in mining.test.ts import
 * this: the result is committed as shared/mining-layout.generated.ts, so no client or server lays them at load.
 *
 * Everything here is plain arithmetic on whole numbers and townRandom (no trigonometry, whose last digit an engine
 * may round its own way), so it lays the very same rocks wherever it runs.
 */

type Point = { readonly x: number; readonly y: number };
const hills = (dx: number, dy: number): Point => ({ x: TOWN_HILLS.left + dx, y: TOWN_HILLS.top + dy });

/** Whether a rock of kind `kind` at (x, y) would stand in the plate room of a rock of kind `under` at (ux, uy). */
const inPlateRoom = (ux: number, uy: number, under: MiningNodeKind, x: number, y: number, kind: MiningNodeKind) => {
  const extent = MINING_ROCK_EXTENT[kind];
  return Math.abs(x - ux) < MINING_PLATE_ROOM.half[under] + extent.half
    && y - extent.up < uy + MINING_PLATE_ROOM.bottom && y + extent.down > uy + MINING_PLATE_ROOM.top;
};

/** About how many rocks an outcrop holds. */
const OUTCROP_ROCKS = 5.5;
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
const TRACK_END = MINING_TRACK[MINING_TRACK.length - 1];
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

export function layHills() {
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
  /** Where a vein's rocks keep their feet. */
  const veinBox = (veinIndex: number) => {
    const vein = MINING_VEINS[veinIndex], last = veinIndex === MINING_VEINS.length - 1;
    return {
      left: vein.left + (veinIndex === 0 ? HILLS_INSET.west : VEIN_INSET), right: vein.right - (last ? HILLS_INSET.east : VEIN_INSET),
      top: TOWN_HILLS.top + HILLS_INSET.north, bottom: TOWN_HILLS.bottom - HILLS_INSET.south,
    };
  };
  type Outcrop = (typeof outcrops)[number];
  type Box = ReturnType<typeof veinBox>;
  // An outcrop's rocks: its heart at (or as near as fits to) its middle, then each next rock beside one already
  // laid, a room's width on, at the free spot nearest the middle along the outcrop's lie.
  const placeIn = (outcrop: Outcrop, kind: MiningNodeKind, attempt: number, box: Box, ore: RockOreId) => {
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
    nodes.push({ id: nodes.length, x: best.x, y: best.y, kind, vein: outcrop.vein, ore });
    return true;
  };
  /** How far an outcrop's middle is from the track, squared. */
  const quiet = (outcrop: Outcrop) => miningTrackDistanceSquared(outcrop.x, outcrop.y);
  MINING_VEINS.forEach((vein, veinIndex) => {
    const last = veinIndex === MINING_VEINS.length - 1;
    const box = veinBox(veinIndex);
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
    const place = (outcrop: Outcrop, kind: MiningNodeKind, attempt: number) => placeIn(outcrop, kind, attempt, box, vein.ore);
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
    veinOutcrops.filter(outcrop => outcrop.rocks.length && nodes[outcrop.rocks[0]].kind === "large")
      .sort((a, b) => quiet(b) - quiet(a)).slice(0, mysterious)
      .forEach(outcrop => { nodes[outcrop.rocks[0]].kind = "mysterious"; });
  });
  // The crystal rocks, laid after every other so those keep their ids and places (the server keeps broken rocks by
  // id): each at the edge of one of its vein's quietest outcrops that has room for it.
  MINING_VEINS.forEach((vein, veinIndex) => {
    const box = veinBox(veinIndex);
    let laid = 0;
    const hosts = outcrops.filter(outcrop => outcrop.vein === veinIndex && outcrop.rocks.length > 0 && outcrop.rocks.length < 8)
      .sort((a, b) => quiet(b) - quiet(a));
    for (const outcrop of hosts) {
      for (let attempt = 200; laid < vein.crystals && attempt < 260; attempt++) if (placeIn(outcrop, "crystal", attempt, box, ARCANE_CRYSTAL)) { laid++; break; }
    }
  });
  return {
    nodes,
    outcrops: outcrops.filter(outcrop => outcrop.rocks.length).map(({ id, vein, x, y, rocks }) => ({ id, vein, x, y, rocks })),
  };
}

/** The text of shared/mining-layout.generated.ts: one rock or outcrop a line. */
export function miningLayoutSource() {
  const { nodes, outcrops } = layHills();
  return [
    "// Generated by npm run generate:mining-layout from shared/mining-layout-generate.ts. Do not edit by hand.",
    "// Rocks by id: [x, y, kind, vein]. Outcrops: [id, vein, x, y, its rocks' ids].",
    "export const MINING_LAYOUT_ROCKS: readonly (readonly [number, number, \"small\" | \"large\" | \"mysterious\" | \"crystal\", number])[] = [",
    ...nodes.map(node => `  [${node.x}, ${node.y}, "${node.kind}", ${node.vein}],`),
    "];",
    "export const MINING_LAYOUT_OUTCROPS: readonly (readonly [number, number, number, number, readonly number[]])[] = [",
    ...outcrops.map(outcrop => `  [${outcrop.id}, ${outcrop.vein}, ${outcrop.x}, ${outcrop.y}, [${outcrop.rocks.join(", ")}]],`),
    "];",
    "",
  ].join("\n");
}
