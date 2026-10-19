import { describe, expect, it } from "vitest";
import { GROVE_ROAD, GROVE_ROAD_FORK, GROVE_ROAD_HALF_WIDTH, WOOD_TREE_NODES, WOODCUTTING_REACH, groveRoadDistanceSquared } from "../../../../shared/woodcutting";
import { MINING_NODES, MINING_TRACK_HALF_WIDTH, miningTrackDistanceSquared } from "../../../../shared/mining";
import { TOWN_FEET_OFFSET, TOWN_GROVE, inTownGrove, inTownWalkArea } from "../../../../shared/town";
import { SOUL_ATLAS } from "../../soul-village";
import { TOWN_GROVE_SIGNPOST, WOOD_TREE_BOXES, lowEnough, spriteBox, townWindowDecor, woodTreeDecor } from "../../town-world";
import type { WorldDecor } from "../../world";
import { paintHillsGround, touchesHillsGround } from "./hills-ground";
import { stumpFrame } from "./wood-tree-renderer";

type Box = { left: number; top: number; right: number; bottom: number };
type Frame = { w: number; h: number; ax: number; ay: number };
const frameOf = (name: string) => (SOUL_ATLAS.frames as Record<string, Frame | undefined>)[name];
const overlap = (a: Box, b: Box, pad = 0) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;

/** Everything the Town draws in and round Timberwood and up the road to it. */
const decor = [...new Set([...townWindowDecor(10_600, 2_400), ...townWindowDecor(8_400, 3_600)])];
type Prop = Extract<WorldDecor, { type: "soulProp" }>;
const props = decor.filter((item): item is Prop => item.type === "soulProp" && !item.shadow && !item.sheet && !item.signpost);
const standing = props.filter(item => !item.ground);
const trees = decor.filter((item): item is Extract<WorldDecor, { type: "woodTree" }> => item.type === "woodTree");
const where = (item: Prop) => `${item.frame} at ${item.x},${item.y}`;

describe("Timberwood as drawn", () => {
  it("draws every tree once, as one of the pack's own trees, with a stump for when it is felled", () => {
    expect(trees.map(tree => tree.node).sort((a, b) => a - b)).toEqual(WOOD_TREE_NODES.map(tree => tree.id));
    for (const tree of WOOD_TREE_NODES) {
      const look = woodTreeDecor(tree);
      expect(frameOf(look.frame), look.frame).toBeTruthy();
      expect(frameOf(stumpFrame(tree.id))).toBeTruthy();
      expect([look.x, look.y]).toEqual([tree.x, tree.y]);
    }
  });

  it("lays only low cover on the grove's floor, and nothing at all on the road", () => {
    const inGrove = props.filter(item => inTownGrove(item.x, item.y));
    expect(inGrove.length).toBeGreaterThan(50);
    expect(inGrove.filter(item => !lowEnough(item.frame as never, item.s)).map(where)).toEqual([]);
    const reach = GROVE_ROAD_HALF_WIDTH + 5;
    expect(props.filter(item => groveRoadDistanceSquared(item.x, item.y) < reach * reach).map(where)).toEqual([]);
    // Nothing standing over the road either, the countryside's trees and the hills' own included.
    const road = GROVE_ROAD.slice(1).flatMap((to, index) => {
      const from = GROVE_ROAD[index];
      return [0, .25, .5, .75].map(t => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }));
    });
    const over = standing.filter(item => {
      const box = spriteBox(frameOf(item.frame)!, item.x, item.y, item.s, item.flip);
      return road.some(point => overlap(box, { left: point.x, right: point.x, top: point.y, bottom: point.y }, GROVE_ROAD_HALF_WIDTH));
    });
    expect(over.map(where)).toEqual([]);
  });

  it("stands its sign at the fork, off the miners' track and the road, with nothing standing in front of it", () => {
    expect(decor).toContain(TOWN_GROVE_SIGNPOST);
    const sign = TOWN_GROVE_SIGNPOST;
    expect(Math.hypot(sign.x - GROVE_ROAD_FORK.x, sign.y - GROVE_ROAD_FORK.y)).toBeLessThan(200);
    expect(Math.sqrt(miningTrackDistanceSquared(sign.x, sign.y))).toBeGreaterThan(MINING_TRACK_HALF_WIDTH + 20);
    expect(Math.sqrt(groveRoadDistanceSquared(sign.x, sign.y))).toBeGreaterThan(GROVE_ROAD_HALF_WIDTH + 20);
    const plank = { left: sign.x - 56, right: sign.x + 80, top: sign.y - 128, bottom: sign.y + 10 };
    expect(standing.filter(item => item.y > sign.y && overlap(spriteBox(frameOf(item.frame)!, item.x, item.y, item.s, item.flip), plank)).map(where)).toEqual([]);
  });
});

describe("chopping in Timberwood", () => {
  it("lets a player stand beside every tree, in its reach and no other's, inside the walls and in plain view", () => {
    // Anything drawn after the player (its foot lower down) and over them hides them: the grove's other trees,
    // and anything standing round it.
    const tall = [
      ...standing.map(item => ({ foot: item.y, box: spriteBox(frameOf(item.frame)!, item.x, item.y, item.s, item.flip) })),
      ...WOOD_TREE_NODES.map(tree => ({ foot: tree.y, box: WOOD_TREE_BOXES[tree.id], id: tree.id })),
    ];
    for (const tree of WOOD_TREE_NODES) {
      const spots = [{ x: tree.x - 50, y: tree.y + 20 }, { x: tree.x + 50, y: tree.y + 20 }, { x: tree.x, y: tree.y + 44 }];
      const good = spots.filter(feet => {
        const inReach = WOOD_TREE_NODES.filter(other => Math.hypot(other.x - feet.x, other.y - feet.y) <= WOODCUTTING_REACH);
        const rocks = MINING_NODES.filter(rock => Math.hypot(rock.x - feet.x, rock.y - feet.y) <= 120);
        const body = { left: feet.x - 22, right: feet.x + 22, top: feet.y - 75, bottom: feet.y };
        return inReach.length === 1 && inReach[0] === tree && !rocks.length && inTownWalkArea(feet.x, feet.y)
          && tall.every(item => item.foot <= feet.y || !overlap(item.box, body));
      });
      expect(good.length, `tree ${tree.id}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps the grove's trees inside it, clear of the Copper Hills' rocks and their walk", () => {
    for (const box of WOOD_TREE_BOXES) {
      expect(box.left).toBeGreaterThan(TOWN_GROVE.left);
      expect(box.right).toBeLessThan(TOWN_GROVE.right);
      expect(box.bottom).toBeLessThan(TOWN_GROVE.bottom);
    }
    for (const tree of WOOD_TREE_NODES) expect(inTownWalkArea(tree.x, tree.y - TOWN_FEET_OFFSET)).toBe(true);
  });
});

describe("the woodcutters' road as painted", () => {
  it("is painted as the miners' track is: its rim, then its earth", () => {
    const painted: string[] = [];
    const context = {
      fillStyle: "", strokeStyle: "", lineWidth: 1, lineJoin: "", lineCap: "",
      save: () => {}, restore: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
      fill() { painted.push(context.fillStyle as string); }, stroke() { painted.push(context.strokeStyle as string); },
    };
    const middle = GROVE_ROAD[Math.floor(GROVE_ROAD.length * .7)];
    const rect = { left: middle.x - 256, top: middle.y - 256, right: middle.x + 256, bottom: middle.y + 256 };
    expect(touchesHillsGround(rect)).toBe(true);
    paintHillsGround(context as unknown as CanvasRenderingContext2D, rect, rect.left, rect.top);
    expect([...new Set(painted)]).toEqual(["#7c6044", "#b89474"]);
  });
});
