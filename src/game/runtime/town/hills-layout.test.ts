import { describe, expect, it } from "vitest";
import {
  MINING_NODES, MINING_OUTCROPS, MINING_REACH, MINING_ROCK_EXTENT, MINING_TRACK, MINING_TRACK_HALF_WIDTH, MINING_VEINS, miningTrackDistanceSquared,
} from "../../../../shared/mining";
import { TOWN_ARRIVAL, TOWN_FEET_OFFSET, TOWN_HILLS, TOWN_HILLS_STONE_FREE, TOWN_WALK_AREA, inTownHills } from "../../../../shared/town";
import { SOUL_ATLAS } from "../../soul-village";
import {
  HILLS_CLEARING_ROUND, HILLS_CLEARINGS, HILLS_EARTH_RIM, MINING_PLATE, ORE_ROCK_BOXES, oreRockDecor, spriteBox, townWindowDecor,
} from "../../town-world";
import type { WorldDecor } from "../../world";
import { paintHillsGround, touchesHillsGround } from "./hills-ground";
import { CRYSTAL_CLUSTERS } from "./ore-rock-renderer";

type Point = { readonly x: number; readonly y: number };
type Box = { left: number; top: number; right: number; bottom: number };
type Frame = { w: number; h: number; ax: number; ay: number };
const frameOf = (name: string) => (SOUL_ATLAS.frames as Record<string, Frame | undefined>)[name]!;

// Plain geometry, kept apart from the layout's own.
const toSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
};
/** Whether a point is inside a convex shape (either way round). */
const inside = (p: Point, shape: readonly Point[]) => {
  let sign = 0;
  for (let index = 0; index < shape.length; index++) {
    const a = shape[index], b = shape[(index + 1) % shape.length];
    const cross = Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    if (!cross) continue;
    if (sign && cross !== sign) return false;
    sign = cross;
  }
  return true;
};
const toShape = (p: Point, shape: readonly Point[]) =>
  inside(p, shape) ? 0 : Math.min(...shape.map((a, index) => toSegment(p, a, shape[(index + 1) % shape.length])));
const crosses = (p: Point, q: Point, r: Point, s: Point) => {
  const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
  if (!d) return false;
  const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d, u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
};
const edges = (shape: readonly Point[]) => shape.map((a, index) => [a, shape[(index + 1) % shape.length]] as const);
/** How far apart two convex shapes are (a segment is one too): 0 where they meet. */
function apart(a: readonly Point[], b: readonly Point[]) {
  if ((a.length > 2 && b.some(p => inside(p, a))) || (b.length > 2 && a.some(p => inside(p, b)))) return 0;
  if (edges(a).some(([p, q]) => edges(b).some(([r, s]) => crosses(p, q, r, s)))) return 0;
  return Math.min(...a.map(p => Math.min(...edges(b).map(([r, s]) => toSegment(p, r, s)))), ...b.map(p => Math.min(...edges(a).map(([r, s]) => toSegment(p, r, s)))));
}
const corners = (box: Box): Point[] => [{ x: box.left, y: box.top }, { x: box.right, y: box.top }, { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom }];
const overlap = (a: Box, b: Box, pad = 0) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
const trackSegments = MINING_TRACK.slice(1).map((to, index) => [MINING_TRACK[index], to] as const);
/** How far a box is from the track's centre line. */
const boxToTrack = (box: Box) => Math.min(...trackSegments
  .filter(([a, b]) => overlap(box, { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) }, 300))
  .map(segment => apart(corners(box), segment)));
const end = MINING_TRACK.at(-1)!;

/** Everything the Town draws in and round the hills, from two windows that between them hold the walk out and the hills. */
const decor = [...new Set([...townWindowDecor(11_200, 5_250), ...townWindowDecor(8_000, 4_200)])];
type Prop = Extract<WorldDecor, { type: "soulProp" }>;
const standing = decor.filter((item): item is Prop => item.type === "soulProp" && !item.ground && !item.shadow && !item.sheet && !item.signpost);
const flat = decor.filter((item): item is Prop => item.type === "soulProp" && Boolean(item.ground) && !item.shadow && !item.sheet);
const boxOf = (item: Prop) => spriteBox(frameOf(item.frame), item.x, item.y, item.s, item.flip);
const near = (item: Prop) => overlap(boxOf(item), { left: TOWN_HILLS.left - 1_800, right: TOWN_HILLS.right, top: TOWN_HILLS.top, bottom: TOWN_HILLS.bottom }, 400);
/** Where the plate that names a rock hangs while it is mined, as big as it is at the default zoom on a desktop. */
const plateSlots = MINING_NODES.map(node => ({ left: node.x - 80, right: node.x + 80, top: node.y + MINING_PLATE.drop, bottom: node.y + MINING_PLATE.drop + 45 }));
const where = (item: Prop) => `${item.frame} at ${item.x},${item.y}`;

describe("the Copper Hills' rocks as laid", () => {
  it("stand where they always have: the server keeps each player's broken rocks by id", () => {
    const fingerprint = MINING_NODES.reduce((hash, node) => Math.imul(hash ^ (node.x * 7_919 + node.y * 104_729 + node.kind.length), 0x9e3779b1) >>> 0, 17);
    expect([MINING_NODES.length, MINING_OUTCROPS.length, fingerprint]).toEqual([100, 18, 67_313_776]);
  });
});

describe("the Copper Hills' rocks as drawn", () => {
  it("are drawn no bigger than the layout leaves each kind room for, Large ones bigger than Small", () => {
    for (const node of MINING_NODES) {
      const box = ORE_ROCK_BOXES[node.id], extent = MINING_ROCK_EXTENT[node.kind];
      expect(box.left).toBeGreaterThanOrEqual(node.x - extent.half - .5);
      expect(box.right).toBeLessThanOrEqual(node.x + extent.half + .5);
      expect(box.top).toBeGreaterThanOrEqual(node.y - extent.up - .5);
      expect(box.bottom).toBeLessThanOrEqual(node.y + extent.down + .5);
    }
    const widths = (kind: string) => MINING_NODES.filter(node => node.kind === kind).map(node => ORE_ROCK_BOXES[node.id].right - ORE_ROCK_BOXES[node.id].left);
    expect(Math.min(...widths("large"))).toBeGreaterThan(Math.max(...widths("small")));
  });

  it("seat their crystals inside the stone, either way round", () => {
    for (const node of MINING_NODES) {
      const rock = oreRockDecor(node), frame = frameOf(rock.frame);
      const clusters = CRYSTAL_CLUSTERS[rock.frame];
      expect(clusters?.length, rock.frame).toBeGreaterThan(0);
      for (const [dx, dy] of clusters) {
        // Each cluster's root sits in from the frame's edges, as drawn and as mirrored.
        for (const [x, left] of [[dx, -frame.ax], [-dx, -(frame.w - frame.ax)]]) {
          expect(x).toBeGreaterThan(left + 8);
          expect(x).toBeLessThan(left + frame.w - 8);
        }
        expect(dy).toBeGreaterThan(-frame.ay + 8);
        expect(dy).toBeLessThan(frame.h - frame.ay - 8);
      }
    }
  });
});

describe("the Copper Hills' ground", () => {
  it("lays each outcrop on one clearing under all its rocks, with grass between clearings", () => {
    expect(HILLS_CLEARINGS.length).toBe(MINING_OUTCROPS.length);
    for (const clearing of HILLS_CLEARINGS) {
      const outcrop = MINING_OUTCROPS.find(each => each.id === clearing.outcrop)!;
      for (const id of outcrop.rocks) {
        // The rock's whole base stands on the earth, with earth to spare round it.
        const box = ORE_ROCK_BOXES[id], foot = MINING_NODES[id];
        for (const point of [{ x: box.left, y: foot.y - 8 }, { x: box.right, y: foot.y - 8 }, { x: foot.x, y: box.bottom }]) {
          expect(toShape(point, clearing.core)).toBeLessThanOrEqual(HILLS_CLEARING_ROUND - 30);
        }
      }
    }
    for (let i = 0; i < HILLS_CLEARINGS.length; i++) for (let j = i + 1; j < HILLS_CLEARINGS.length; j++) {
      expect(apart(HILLS_CLEARINGS[i].core, HILLS_CLEARINGS[j].core) - 2 * HILLS_CLEARING_ROUND).toBeGreaterThan(40);
    }
  });

  it("keeps grass between the track and every clearing but the one it ends in", () => {
    const ending = HILLS_CLEARINGS.filter(clearing => toShape(end, clearing.core) <= HILLS_CLEARING_ROUND);
    expect(ending).toHaveLength(1);
    for (const clearing of HILLS_CLEARINGS) {
      if (clearing === ending[0]) continue;
      const nearest = Math.min(...clearing.core.map(point => Math.sqrt(miningTrackDistanceSquared(point.x, point.y))));
      expect(nearest - HILLS_CLEARING_ROUND - MINING_TRACK_HALF_WIDTH - HILLS_EARTH_RIM).toBeGreaterThan(30);
    }
  });
});

describe("the Copper Hills' baked ground", () => {
  it("is painted only round the hills and the track: darker grass, then every rim, then every earth", () => {
    // The village square's tiles never reach it.
    expect(touchesHillsGround({ left: TOWN_ARRIVAL.x - 320, right: TOWN_ARRIVAL.x + 320, top: TOWN_ARRIVAL.y - 320, bottom: TOWN_ARRIVAL.y + 320 })).toBe(false);
    const painted: string[] = [];
    const context = {
      fillStyle: "", strokeStyle: "", lineWidth: 1, lineJoin: "", lineCap: "",
      save: () => {}, restore: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
      fill() { painted.push(context.fillStyle as string); }, stroke() { painted.push(context.strokeStyle as string); },
    };
    // A tile on the first quarry, which the track passes.
    const first = HILLS_CLEARINGS[0].box;
    const rect = { left: first.left, top: first.top - 400, right: first.left + 512, bottom: first.top + 112 };
    paintHillsGround(context as unknown as CanvasRenderingContext2D, rect, rect.left, rect.top);
    const order = [...new Set(painted)];
    expect(order).toEqual(["#54783c", "#7c6044", "#b89474"]);
    // Nothing painted at all far out in the countryside.
    painted.length = 0;
    paintHillsGround(context as unknown as CanvasRenderingContext2D, { left: 2_000, top: 2_000, right: 2_512, bottom: 2_512 }, 2_000, 2_000);
    expect(painted).toEqual([]);
  });
});

describe("the Copper Hills' scenery", () => {
  it("keeps everything standing clear of the rocks, their clearings, their plates and the track", () => {
    const checked = standing.filter(near);
    expect(checked.length).toBeGreaterThan(300);
    for (const item of checked) {
      const box = boxOf(item);
      for (const rock of ORE_ROCK_BOXES) expect(overlap(box, rock), `${where(item)} over a rock`).toBe(false);
      for (const slot of plateSlots) expect(overlap(box, slot), `${where(item)} over a plate`).toBe(false);
      for (const clearing of HILLS_CLEARINGS) {
        if (!overlap(box, clearing.box, HILLS_CLEARING_ROUND)) continue;
        expect(apart(corners(box), clearing.core), `${where(item)} on a clearing`).toBeGreaterThan(HILLS_CLEARING_ROUND);
      }
      expect(boxToTrack(box), `${where(item)} over the track`).toBeGreaterThan(MINING_TRACK_HALF_WIDTH + HILLS_EARTH_RIM);
    }
  });

  it("grows no grass or flowers on the bare earth", () => {
    for (const item of flat.filter(near)) {
      const point = { x: item.x, y: item.y };
      for (const clearing of HILLS_CLEARINGS) expect(toShape(point, clearing.core), where(item)).toBeGreaterThan(HILLS_CLEARING_ROUND);
      expect(Math.sqrt(miningTrackDistanceSquared(item.x, item.y)), where(item)).toBeGreaterThan(MINING_TRACK_HALF_WIDTH + HILLS_EARTH_RIM);
      for (const rock of ORE_ROCK_BOXES) expect(overlap({ left: item.x, right: item.x, top: item.y, bottom: item.y }, rock), where(item)).toBe(false);
    }
  });

  it("frames the hills with trees all round, but for a way in where the track comes from the west", () => {
    const trees = standing.filter(item => /^Tree_\d+_Green$/.test(item.frame));
    const { left, right, top, bottom } = TOWN_HILLS;
    const count = (test: (item: Prop) => boolean) => trees.filter(test).length;
    const across = (item: Prop) => item.x > left && item.x < right, down = (item: Prop) => item.y > top && item.y < bottom;
    expect(count(item => across(item) && item.y < top && item.y > top - 300)).toBeGreaterThan(40);
    expect(count(item => across(item) && item.y > bottom && item.y < bottom + 300)).toBeGreaterThan(40);
    expect(count(item => down(item) && item.x > right && item.x < right + 300)).toBeGreaterThan(25);
    expect(count(item => down(item) && item.x < left && item.x > left - 300)).toBeGreaterThan(20);
    // The way in: the track comes through the west row of trees by an open gap.
    const entry = MINING_TRACK.find(point => point.x >= left)!;
    expect(trees.filter(item => item.x < left + 50 && item.x > left - 300 && Math.abs(item.y - entry.y) < 220)).toEqual([]);
  });

  it("divides each vein from the next with a hedge, open where the track crosses, and grows nothing tall among the rocks", () => {
    for (const vein of MINING_VEINS.slice(1)) {
      const hedge = standing.filter(item => Math.abs(item.x - vein.left) < 30 && item.y > TOWN_HILLS.top && item.y < TOWN_HILLS.bottom);
      expect(hedge.length).toBeGreaterThan(18);
      const crossing = MINING_TRACK.find(point => point.x >= vein.left)!;
      expect(hedge.filter(item => Math.abs(item.y - crossing.y) < 150)).toEqual([]);
    }
    // Inside the hills, off their edges and the hedges, nothing grows taller than a tuft of grass.
    const hedges = MINING_VEINS.slice(1).map(vein => vein.left);
    const among = standing.filter(item => inTownHills(item.x, item.y, -120) && hedges.every(x => Math.abs(item.x - x) > 40));
    expect(among.filter(item => !/^Grass_/.test(item.frame)).map(where)).toEqual([]);
  });

  it("leaves no plain stones near the hills, which would read as rocks with nothing in them", () => {
    expect(standing.filter(item => /^Stone_/.test(item.frame) && inTownHills(item.x, item.y, TOWN_HILLS_STONE_FREE)).map(where)).toEqual([]);
  });
});

describe("mining in the Copper Hills", () => {
  it("lets a player stand beside every rock, in its reach and no other's, inside the walls and in plain view", () => {
    const tall = standing.filter(near).map(boxOf);
    for (const node of MINING_NODES) {
      // Feet a little to either side of the rock's foot, or just in front of it.
      const spots = [{ x: node.x - 58, y: node.y }, { x: node.x + 58, y: node.y }, { x: node.x, y: node.y + 50 }];
      const good = spots.filter(feet => {
        const inReach = MINING_NODES.filter(other => Math.hypot(other.x - feet.x, other.y - feet.y) <= MINING_REACH);
        const player = { x: feet.x, y: feet.y - TOWN_FEET_OFFSET };
        const body = { left: feet.x - 22, right: feet.x + 22, top: feet.y - 75, bottom: feet.y };
        return inReach.length === 1 && inReach[0] === node
          && player.x > TOWN_WALK_AREA.left && player.x < TOWN_WALK_AREA.right && player.y > TOWN_WALK_AREA.top && player.y < TOWN_WALK_AREA.bottom
          && tall.every(box => !overlap(box, body));
      });
      expect(good.length, `rock ${node.id}`).toBeGreaterThanOrEqual(2);
    }
  });
});
