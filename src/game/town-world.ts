import { inTownInteriors, inTownVillage, TOWN_ARRIVAL, TOWN_BENCH_POSITION, TOWN_CARD_SELLER_STALL, TOWN_CHUNK_SIZE, TOWN_HILLS, TOWN_HILLS_SIGNPOST_POSITION, TOWN_INTERIOR_MARGIN, TOWN_OX_POSITION, TOWN_QUEST_BOARD_POSITION, TOWN_RESEARCH_POSITION, TOWN_SMITH_POSITION, townChunkProps, townRandom, townWindowChunks, type TownPropKind, TOWN_SOUL_RUNESTONE } from "../../shared/town";
import { SOUL_ATLAS, SOUL_INTERIOR_DECOR, SOUL_VILLAGE_DECOR, type SoulFrame } from "./soul-village";
import {
  MINING_NODES, MINING_OUTCROPS, MINING_REACH, MINING_TRACK, MINING_TRACK_HALF_WIDTH, MINING_VEINS, miningTrackDistanceSquared, type MiningNode, type MiningNodeKind,
} from "../../shared/mining";
import type { WorldDecor, WorldPath } from "./world";

/** How each countryside prop is drawn: one of its atlas frames (by the prop's variant) and its size. */
export const PROP_FRAMES: Readonly<Record<TownPropKind, { frames: readonly SoulFrame[]; s: number }>> = {
  tree: { frames: ["Tree_01_Green", "Tree_02_Green", "Tree_03_Green", "Tree_04_Green", "Tree_05_Green", "Tree_06_Green", "Tree_07_Green", "Tree_08_Green",
    "Tree_09_Green", "Tree_10_Green", "Tree_11_Green", "Tree_12_Green", "Tree_13_Green", "Tree_14_Green", "Tree_15_Green", "Tree_16_Green",
    "Tree_17_Green", "Tree_18_Green", "Tree_19_Green"], s: 1 },
  smallTree: { frames: ["Small_Tree_01_Green", "Small_Tree_02_Green", "Small_Tree_03_Green"], s: 1 },
  birch: { frames: ["Birch_01_Green", "Birch_02_Green"], s: 1 },
  bush: { frames: ["Bush_01_Green", "Bush_02_Green", "Bush_03_Green", "Bush_04_Green", "Bush_05_Green"], s: 1 },
  grass: { frames: ["Grass_01_Green", "Grass_02_Green", "Grass_03_Green", "Grass_04_Green", "Grass_05_Green", "Grass_06_Green", "Grass_07_Green",
    "Grass_08_Green", "Grass_09_Green", "Grass_10_Green"], s: 1 },
  flower: { frames: ["Flower_01_Blue", "Flower_01_Yellow"], s: 1 },
  mushroom: { frames: ["Mushroom_01_Pink", "Mushroom_02_Pink", "Mushroom_03_Pink", "Mushroom_01_White", "Mushroom_02_White", "Mushroom_03_White",
    "Mushroom_01_Yellow", "Mushroom_02_Yellow", "Mushroom_03_Yellow"], s: 1 },
  stone: { frames: ["Stone_02_Gray", "Stone_03_Gray", "Stone_04_Gray"], s: 1 },
  stoneSmall: { frames: ["Stone_01_Gray", "Stone_05_Gray", "Stone_06_Gray", "Stone_07_Gray"], s: 1 },
  log: { frames: ["Tree_Log_01", "Tree_Log_02", "Tree_Log_03"], s: 1 },
  stump: { frames: ["Tree_Stump_01", "Tree_Stump_02", "Tree_Stump_03"], s: 1 },
};

/**
 * Props too low to stand in front of anyone are drawn with the ground. A tall
 * tuft of grass or a big mushroom stands, and sorts against players and trees
 * like anything else that does.
 */
const FLAT_HEIGHT = 30;
export const lowEnough = (frame: SoulFrame, s: number) => SOUL_ATLAS.frames[frame].ay * s <= FLAT_HEIGHT;

/**
 * Home's three stations, in the Town's buildings (shared/town.ts places them): each stands where a piece of
 * its room's furniture did, so that piece is not drawn (its collider stays, as the station's).
 */
export const TOWN_STATION_DECOR: readonly WorldDecor[] = [
  { type: "upgradeBench", x: TOWN_BENCH_POSITION.x, y: TOWN_BENCH_POSITION.y, s: 1, label: "Upgrade Bench" },
  { type: "upgradeBench", x: TOWN_RESEARCH_POSITION.x, y: TOWN_RESEARCH_POSITION.y, s: 1, label: "Tech Research" },
  { type: "upgradeBench", x: TOWN_QUEST_BOARD_POSITION.x, y: TOWN_QUEST_BOARD_POSITION.y, s: 1, label: "Quest Board" },
];
const replacedByStation = (item: WorldDecor) => TOWN_STATION_DECOR.some(station => item.x === station.x && Math.abs(item.y - station.y) < 40);
/** Ox, the Galaxy set's seller, drawn from the original player sprite and depth-sorted with the room's furniture. */
export const TOWN_OX_DECOR: WorldDecor = { type: "upgradeBench", x: TOWN_OX_POSITION.x, y: TOWN_OX_POSITION.y, s: 1, label: "Ox" };
/** The Smith, who refines gear, in the forge house's yard on the square: a villager drawn in smith's gear. */
export const TOWN_SMITH_DECOR: WorldDecor = { type: "upgradeBench", x: TOWN_SMITH_POSITION.x, y: TOWN_SMITH_POSITION.y, s: 1, label: "Smith" };
/** The Card Seller's name over the village's own market stall: just in front of it, so it draws over the awning. */
export const TOWN_CARD_SELLER_DECOR: WorldDecor = { type: "upgradeBench", x: TOWN_CARD_SELLER_STALL.x, y: TOWN_CARD_SELLER_STALL.y + 1, s: 1, label: "Card Seller" };
export const TOWN_INTERIOR_DECOR: readonly WorldDecor[] = [...SOUL_INTERIOR_DECOR.filter(item => !replacedByStation(item)), ...TOWN_STATION_DECOR, TOWN_OX_DECOR];

/**
 * The square's signpost, just east of where every traveller lands (on open cobbles, clear of the fountain,
 * the barn's hay and the doors): its plank, labelled Travel, points up the road to the travel portal.
 */
/** The rune stone beside the Soul Dimension's portal (the pack's RuneStone_01, in the countryside's atlas). */
export const TOWN_RUNESTONE: WorldDecor = { type: "soulProp", frame: "RuneStone_01", s: .8, ...TOWN_SOUL_RUNESTONE };
export const TOWN_SIGNPOST: WorldDecor = { type: "soulProp", frame: "", s: 1, x: TOWN_ARRIVAL.x + 230, y: TOWN_ARRIVAL.y - 10, signpost: "Travel" };
/** Its twin by the Smith's yard, pointing east: the way to the Copper Hills, where his pickaxe is for. */
export const TOWN_HILLS_SIGNPOST: WorldDecor = { type: "soulProp", frame: "", s: 1, ...TOWN_HILLS_SIGNPOST_POSITION, signpost: "Copper Hills", flip: true };

// ---- The Copper Hills ----

type Point = { readonly x: number; readonly y: number };
type Box = { left: number; top: number; right: number; bottom: number };
type Frame = { w: number; h: number; ax: number; ay: number };
const atlasFrame = (name: string) => (SOUL_ATLAS.frames as Record<string, Frame | undefined>)[name];
/** Where a sprite drawn from its foot covers, in world units. */
export function spriteBox(frame: Frame, x: number, y: number, s: number, flip = false): Box {
  const left = x - (flip ? frame.w - frame.ax : frame.ax) * s, top = y - frame.ay * s;
  return { left, top, right: left + frame.w * s, bottom: top + frame.h * s };
}

/**
 * The pack's own stones the ore rocks are drawn on, by kind: a Small rock is one of the two round ones, a Large rock
 * the tall boulder (a little bigger) or the wide one, and a Mysterious rock always the tall boulder.
 */
const ROCK_LOOKS: Readonly<Record<MiningNodeKind, readonly { frame: SoulFrame; s: number }[]>> = {
  small: [{ frame: "Stone_01_Gray", s: 1 }, { frame: "Stone_04_Gray", s: 1 }],
  large: [{ frame: "Stone_02_Gray", s: 1.12 }, { frame: "Stone_07_Gray", s: 1 }],
  mysterious: [{ frame: "Stone_02_Gray", s: 1.12 }],
};
export function oreRockDecor(node: MiningNode): Extract<WorldDecor, { type: "oreRock" }> {
  const looks = ROCK_LOOKS[node.kind], look = looks[node.id % looks.length];
  return { type: "oreRock", x: node.x, y: node.y, s: look.s, node: node.id, frame: look.frame, flip: node.id % 3 === 0 };
}
const ROCK_DECOR = MINING_NODES.map(oreRockDecor);
/** Each rock's sprite, as drawn. */
export const ORE_ROCK_BOXES: readonly Box[] = ROCK_DECOR.map(rock => spriteBox(atlasFrame(rock.frame)!, rock.x, rock.y, rock.s, rock.flip));

// Convex shapes, for the clearings and what keeps off them.
const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (list: Point[]) => {
    const hull: Point[] = [];
    for (const point of list) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
function segmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y);
}
/** Whether two convex shapes overlap: no edge of either separates them. */
function convexOverlap(a: readonly Point[], b: readonly Point[]) {
  for (const shape of [a, b]) {
    for (let index = 0; index < shape.length; index++) {
      const p = shape[index], q = shape[(index + 1) % shape.length], nx = q.y - p.y, ny = p.x - q.x;
      if (!nx && !ny) continue;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const v of a) { const d = v.x * nx + v.y * ny; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); }
      for (const v of b) { const d = v.x * nx + v.y * ny; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); }
      if (aMax < bMin || bMax < aMin) return false;
    }
  }
  return true;
}
/** How far apart two convex shapes are (a segment counts as one): 0 where they overlap. */
function convexDistance(a: readonly Point[], b: readonly Point[]) {
  if (convexOverlap(a, b)) return 0;
  let best = Infinity;
  for (const [from, to] of [[a, b], [b, a]]) {
    for (const point of from) for (let index = 0; index < to.length; index++) best = Math.min(best, segmentDistance(point, to[index], to[(index + 1) % to.length]));
  }
  return best;
}
const corners = (box: Box): Point[] => [{ x: box.left, y: box.top }, { x: box.right, y: box.top }, { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom }];
const boxOf = (points: readonly Point[]): Box => ({
  left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
});
const near = (a: Box, b: Box, pad: number) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;

/**
 * A clearing's shape: a core, rounded off HILLS_CLEARING_ROUND all round, which leaves at least
 * HILLS_CLEARING_MARGIN of bare earth past every rock's footprint; then the darker grass worn round it.
 */
export const HILLS_CLEARING_ROUND = 125;
const HILLS_CLEARING_MARGIN = 46;
export const HILLS_ROUGH_MARGIN = 40;
/** The earth rim round the clearings and the track, as the village's roads have. */
export const HILLS_EARTH_RIM = 5;
/** A clearing whose earth would come within this of the track's joins it instead. */
const HILLS_TRACK_JOIN = 40;
export type HillsClearing = { outcrop: number; core: readonly Point[]; box: Box };
/**
 * Each outcrop's clearing: one round shape of bare earth under all its rocks, so they stand on worn ground and the
 * grass between outcrops stays whole. Its core is the hull of the rocks' footprints, each pulled in towards their
 * middle by the rounding less the margin: rounded off by HILLS_CLEARING_ROUND, it reaches every footprint and
 * the margin past it, and its bends are wide and soft rather than a hull's corners.
 */
export const HILLS_CLEARINGS: readonly HillsClearing[] = MINING_OUTCROPS.map(outcrop => {
  const points = outcrop.rocks.flatMap(id => {
    const rock = ROCK_DECOR[id], frame = atlasFrame(rock.frame)!;
    // The rock's footprint on the ground: as wide as it is, half as deep, a little behind its foot.
    const half = frame.w * rock.s / 2, deep = half * .45;
    return [{ x: rock.x - half, y: rock.y - deep }, { x: rock.x + half, y: rock.y - deep }, { x: rock.x, y: rock.y - deep * 2 }, { x: rock.x, y: rock.y + 10 }];
  });
  const middle = { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  const pullTowards = (p: Point, by: number) => {
    const dx = middle.x - p.x, dy = middle.y - p.y, length = Math.hypot(dx, dy), t = length > by ? by / length : 1;
    return { x: p.x + dx * t, y: p.y + dy * t };
  };
  let core = convexHull(points.map(p => pullTowards(p, HILLS_CLEARING_ROUND - HILLS_CLEARING_MARGIN)));
  // All pulled to the middle: a speck of a core, still a shape.
  if (core.length < 3) core = [{ x: middle.x, y: middle.y - 1 }, { x: middle.x + 1, y: middle.y + 1 }, { x: middle.x - 1, y: middle.y + 1 }];
  // The rocks keep far enough off the track that their clearings leave grass between (shared/mining.ts), but for the
  // outcrop round the track's end: that clearing opens onto the track, broadly, out to its far edge, rather than
  // just grazing it, which would leave thin slivers of grass and sharp nicks where the two meet.
  let nearest = { distance: Infinity, index: -1 };
  MINING_TRACK.forEach((point, index) => {
    const distance = convexDistance([point], core);
    if (distance < nearest.distance) nearest = { distance, index };
  });
  if (nearest.distance - HILLS_CLEARING_ROUND - MINING_TRACK_HALF_WIDTH < HILLS_TRACK_JOIN) {
    const mouth = MINING_TRACK.slice(Math.max(0, nearest.index - 2), nearest.index + 3);
    core = convexHull([...core, ...mouth.map(p => pullTowards(p, HILLS_CLEARING_ROUND - MINING_TRACK_HALF_WIDTH))]);
  }
  return Object.freeze({ outcrop: outcrop.id, core: Object.freeze(core), box: boxOf(core) });
});
/**
 * The plate that names the rock being mined, with its progress, hangs below the rock (ore-rock-renderer.ts): this
 * far below its foot, just past the reach, so never on whoever mines it (their feet come no lower); at most this
 * big on screen, as it keeps its size there as every label does.
 */
export const MINING_PLATE = Object.freeze({ drop: MINING_REACH + 10, width: 150, height: 34 });
/** Where each rock's plate would hang, in the world, as big as it is at the default zoom on a desktop or a phone: nothing standing grows there. */
const PLATE_SLOTS: readonly Box[] = MINING_NODES.map(node => ({ left: node.x - 100, right: node.x + 100, top: node.y + MINING_PLATE.drop, bottom: node.y + MINING_PLATE.drop + 56 }));
const TRACK_SEGMENTS = MINING_TRACK.slice(1).map((to, index) => {
  const from = MINING_TRACK[index];
  return { ends: [from, to], box: boxOf([from, to]) };
});
/** How wide the track is, its rim and all. */
const TRACK_REACH = MINING_TRACK_HALF_WIDTH + HILLS_EARTH_RIM;

/** Whether a standing sprite comes within `pad` of what the hills keep clear: a clearing, an ore rock or its plate, the track. */
function crowdsHills(box: Box, pad: number) {
  const shape = corners(box);
  for (const clearing of HILLS_CLEARINGS) {
    if (near(box, clearing.box, HILLS_CLEARING_ROUND + pad) && convexDistance(shape, clearing.core) < HILLS_CLEARING_ROUND + pad) return true;
  }
  if (ORE_ROCK_BOXES.some(rock => near(box, rock, pad)) || PLATE_SLOTS.some(slot => near(box, slot, pad))) return true;
  return TRACK_SEGMENTS.some(segment => near(box, segment.box, TRACK_REACH + pad) && convexDistance(shape, segment.ends) < TRACK_REACH + pad);
}
/** Whether a point is on the hills' bare earth (or within `pad` of it): a clearing, under an ore rock, the track. */
function onHillsEarth(x: number, y: number, pad: number) {
  const point = [{ x, y }];
  for (const clearing of HILLS_CLEARINGS) {
    if (near({ left: x, right: x, top: y, bottom: y }, clearing.box, HILLS_CLEARING_ROUND + pad) && convexDistance(point, clearing.core) < HILLS_CLEARING_ROUND + pad) return true;
  }
  if (ORE_ROCK_BOXES.some(rock => x > rock.left - pad && x < rock.right + pad && y > rock.top - pad && y < rock.bottom + pad)) return true;
  return miningTrackDistanceSquared(x, y, TRACK_REACH + pad) < (TRACK_REACH + pad) ** 2;
}

type Placed = { frame: SoulFrame; x: number; y: number; s: number; flip: boolean };
/** The trees that frame the hills: big round ones and pines, in a staggered double row. */
const BORDER_TREES: readonly SoulFrame[] = ["Tree_07_Green", "Tree_08_Green", "Tree_09_Green", "Tree_10_Green", "Tree_03_Green", "Tree_18_Green", "Tree_19_Green", "Tree_17_Green"];
/** The hedges between the veins: bushes, now and then a small tree. */
const HEDGE_BUSHES: readonly SoulFrame[] = ["Bush_01_Green", "Bush_02_Green", "Bush_03_Green", "Bush_02_Green", "Bush_01_Green"];
const HEDGE_TREES: readonly SoulFrame[] = ["Tree_02_Green", "Tree_01_Green", "Tree_03_Green"];
const COVER_GRASS: readonly SoulFrame[] = ["Grass_01_Green", "Grass_02_Green", "Grass_03_Green", "Grass_04_Green", "Grass_05_Green", "Grass_06_Green"];
const COVER_FLOWERS: readonly SoulFrame[] = ["Flower_01_Blue", "Flower_01_Yellow"];
const pick = <T>(list: readonly T[], random: () => number) => list[Math.floor(random() * list.length)];
/** Where the track comes in through the trees on the hills' west side: no tree within this of its line there. */
const HILLS_WAY_IN = 230;

/**
 * The hills' own scenery (the countryside's props keep out of them, shared/town.ts): a double row of trees round
 * the hills with a gap where the track comes in from the west, a hedge of bushes between each vein and the next
 * with gaps to walk through, and grass and flowers on the open ground between the outcrops. Nothing standing comes
 * near a clearing, a rock or the track, so the rocks and whoever mines them stay in view; nothing at all grows on
 * the bare earth. Laid once, from the coordinates alone, and kept by chunk.
 */
function layHillsScenery() {
  const placed: Placed[] = [];
  const stand = (frame: SoulFrame, x: number, y: number, s: number, flip: boolean, pad: number) => {
    const look = atlasFrame(frame);
    if (!look) return false;
    x = Math.round(x); y = Math.round(y);
    if (crowdsHills(spriteBox(look, x, y, s, flip), pad)) return false;
    placed.push({ frame, x, y, s, flip });
    return true;
  };
  // The trees round the hills: an inner row and, staggered behind it, an outer one.
  const { left, right, top, bottom } = TOWN_HILLS;
  const sides = [
    { from: { x: left - 260, y: top }, to: { x: right + 260, y: top }, out: { x: 0, y: -1 } },
    { from: { x: left - 260, y: bottom }, to: { x: right + 260, y: bottom }, out: { x: 0, y: 1 } },
    { from: { x: right, y: top + 120 }, to: { x: right, y: bottom - 120 }, out: { x: 1, y: 0 } },
    { from: { x: left, y: top + 120 }, to: { x: left, y: bottom - 120 }, out: { x: -1, y: 0 } },
  ];
  sides.forEach((side, sideIndex) => {
    const length = Math.hypot(side.to.x - side.from.x, side.to.y - side.from.y), along = { x: (side.to.x - side.from.x) / length, y: (side.to.y - side.from.y) / length };
    for (const [row, offset, step] of [[0, 80, 150], [1, 215, 165]] as const) {
      for (let at = row * step / 2, slot = 0; at <= length; at += step, slot++) {
        const random = townRandom(sideIndex, row, slot, 61);
        const along2 = at + (random() - .5) * 50, out = offset + (random() - .5) * 46;
        const x = side.from.x + along.x * along2 + side.out.x * out, y = side.from.y + along.y * along2 + side.out.y * out;
        if (sideIndex === 3 && miningTrackDistanceSquared(x, y, HILLS_WAY_IN) < HILLS_WAY_IN * HILLS_WAY_IN) continue;
        stand(pick(BORDER_TREES, random), x, y, .92 + random() * .16, random() < .5, 16);
      }
    }
  });
  // The hedges between the veins, in runs with gaps between them (and wherever the track crosses).
  MINING_VEINS.slice(1).forEach((vein, index) => {
    const random = townRandom(index, 67);
    const run = 560 + Math.floor(random() * 120), gap = 170, phase = Math.floor(random() * (run + gap));
    for (let y = top + 70, slot = 0; y <= bottom - 70; y += 74, slot++) {
      if ((y - top + phase) % (run + gap) >= run) continue;
      const x = vein.left + (random() - .5) * 26, at = y + (random() - .5) * 20;
      if (miningTrackDistanceSquared(x, at, 190) < 190 * 190) continue;
      const tree = slot % 6 === 3;
      stand(pick(tree ? HEDGE_TREES : HEDGE_BUSHES, random), x, at, .95 + random() * .1, random() < .5, 12);
    }
  });
  // Grass in small clumps, and now and then a few flowers, on the open ground: never on the bare earth, and a tuft
  // tall enough to stand keeps clear as anything standing does.
  const cover = (frame: SoulFrame, x: number, y: number, s: number, flip: boolean, pad: number) => {
    if (!lowEnough(frame, s)) stand(frame, x, y, s, flip, pad);
    else if (!onHillsEarth(x, y, pad)) placed.push({ frame, x, y, s, flip });
  };
  for (let gy = top - 120; gy < bottom + 120; gy += 230) {
    for (let gx = left - 120; gx < right + 120; gx += 230) {
      const random = townRandom(gx, gy, 71);
      if (random() < .45) {
        const cx = gx + random() * 230, cy = gy + random() * 230, tufts = 2 + Math.floor(random() * 3);
        for (let tuft = 0; tuft < tufts; tuft++) {
          const x = Math.round(cx + (random() - .5) * 70), y = Math.round(cy + (random() - .5) * 44);
          cover(pick(COVER_GRASS, random), x, y, .9 + random() * .25, random() < .5, 14);
        }
      }
      if (random() < .16) {
        const cx = gx + random() * 230, cy = gy + random() * 230, frame = pick(COVER_FLOWERS, random);
        for (let flower = 0; flower < 3; flower++) {
          const x = Math.round(cx + (random() - .5) * 46), y = Math.round(cy + (random() - .5) * 30);
          cover(frame, x, y, 1, random() < .5, 10);
        }
      }
    }
  }
  const byChunk = new Map<string, Placed[]>();
  for (const item of placed) {
    const key = `${Math.floor(item.x / TOWN_CHUNK_SIZE)}:${Math.floor(item.y / TOWN_CHUNK_SIZE)}`;
    byChunk.set(key, [...byChunk.get(key) ?? [], item]);
  }
  return byChunk;
}
let hillsScenery: Map<string, Placed[]> | null = null;
/** The ore rocks in each countryside chunk. */
let rocksByChunk: Map<string, MiningNode[]> | null = null;
function rocksIn(cx: number, cy: number) {
  if (!rocksByChunk) {
    rocksByChunk = new Map();
    for (const node of MINING_NODES) {
      const key = `${Math.floor(node.x / TOWN_CHUNK_SIZE)}:${Math.floor(node.y / TOWN_CHUNK_SIZE)}`;
      rocksByChunk.set(key, [...rocksByChunk.get(key) ?? [], node]);
    }
  }
  return rocksByChunk.get(`${cx}:${cy}`) ?? [];
}
/** The pack's stone shadow (the only one it has), stretched under each ore rock to its width, just showing past its foot. */
const ROCK_SHADOW = "Stone_04_Gray__shadow";
function oreRockShadow(rock: Extract<WorldDecor, { type: "oreRock" }>): WorldDecor {
  const frame = atlasFrame(rock.frame)!, shadow = atlasFrame(ROCK_SHADOW)!;
  const s = frame.w * rock.s * .92 / shadow.w, below = (frame.h - frame.ay) * rock.s;
  return { type: "soulProp", x: rock.x, y: Math.round(rock.y + below + 5 - (shadow.h - shadow.ay) * s), s, frame: ROCK_SHADOW, flip: rock.flip, shadow: true };
}

/** Every prop in the chunk window around a point: the village's and its rooms' when they are near, and the countryside's. */
export function townWindowDecor(x: number, y: number): WorldDecor[] {
  const decor: WorldDecor[] = inTownVillage(x, y, TOWN_CHUNK_SIZE * 2.5) ? [...SOUL_VILLAGE_DECOR, TOWN_SIGNPOST, TOWN_RUNESTONE, TOWN_SMITH_DECOR, TOWN_CARD_SELLER_DECOR, TOWN_HILLS_SIGNPOST] : [];
  if (inTownInteriors(x, y, TOWN_INTERIOR_MARGIN)) decor.push(...TOWN_INTERIOR_DECOR);
  for (const { cx, cy } of townWindowChunks(x, y)) decor.push(...townChunkDecor(cx, cy));
  return decor;
}

/** Everything the hills keep clear lies in here: past it, a countryside prop need not be looked at twice. */
const HILLS_CLEAR_AREA = {
  left: Math.min(TOWN_HILLS.left, ...MINING_TRACK.map(point => point.x)) - 200, right: TOWN_HILLS.right + 200,
  top: Math.min(TOWN_HILLS.top, ...MINING_TRACK.map(point => point.y)) - 200, bottom: Math.max(TOWN_HILLS.bottom, ...MINING_TRACK.map(point => point.y)) + 200,
};

const chunkDecor = new Map<string, readonly WorldDecor[]>();
/**
 * One countryside chunk's props as decor, each tree's or stone's shadow just before it, then the Copper Hills'
 * own scenery and ore rocks (each rock's shadow under it). The countryside never changes, so each chunk is made
 * once and shared by every window (and the ground's baked tiles) that holds it. Where the miners' track runs
 * through the countryside, nothing grows on it and nothing stands over it.
 */
export function townChunkDecor(cx: number, cy: number): readonly WorldDecor[] {
  const key = `${cx}:${cy}`;
  let decor = chunkDecor.get(key);
  if (decor) return decor;
  const made: WorldDecor[] = [];
  const add = (frame: SoulFrame, x: number, y: number, s: number, flip: boolean) => {
    const shadow = `${frame}__shadow`;
    if (shadow in SOUL_ATLAS.frames) made.push({ type: "soulProp", x, y, s, frame: shadow, flip, shadow: true });
    made.push({ type: "soulProp", x, y, s, frame, flip, ground: lowEnough(frame, s) });
  };
  for (const prop of townChunkProps(cx, cy)) {
    const look = PROP_FRAMES[prop.kind];
    const frame = look.frames[prop.variant % look.frames.length], s = look.s * prop.s;
    const box = spriteBox(atlasFrame(frame)!, prop.x, prop.y, s, prop.flip);
    if (near(box, HILLS_CLEAR_AREA, 0) && (lowEnough(frame, s) ? onHillsEarth(prop.x, prop.y, 10) : crowdsHills(box, 14))) continue;
    add(frame, prop.x, prop.y, s, prop.flip);
  }
  hillsScenery ??= layHillsScenery();
  for (const item of hillsScenery.get(key) ?? []) add(item.frame, item.x, item.y, item.s, item.flip);
  for (const node of rocksIn(cx, cy)) made.push(oreRockShadow(ROCK_DECOR[node.id]), ROCK_DECOR[node.id]);
  decor = Object.freeze(made);
  chunkDecor.set(key, decor);
  return decor;
}

/** The village's ground is one baked image (soul-prop-renderer.ts), so there are no painted paths. */
export function townWorldLayout(x: number, y: number): { decor: WorldDecor[]; paths: WorldPath[] } {
  return { decor: townWindowDecor(x, y), paths: [] };
}
