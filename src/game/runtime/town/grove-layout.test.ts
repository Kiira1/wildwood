import { describe, expect, it } from "vitest";
import { GROVE_LANDING_RADIUS, GROVE_ROAD, GROVE_ROAD_END, GROVE_ROAD_HALF_WIDTH, GROVE_ROAD_START, WOOD_TREE_NODES, WOOD_TREE_SPOTS, WOOD_TREE_SPREAD, WOODCUTTING_REACH, groveRoadDistanceSquared } from "../../../../shared/woodcutting";
import { MINING_NODES } from "../../../../shared/mining";
import { TOWN_FEET_OFFSET, TOWN_GROVE, TOWN_WEST_BRIDGE, inTownGrove, inTownWalkArea } from "../../../../shared/town";
import { SOUL_ATLAS } from "../../town-village";
import { GROVE_LANDING_DECOR, TOWN_GROVE_SIGNPOST, WOOD_TREE_BOXES, lowEnough, spriteBox, townWindowDecor, woodTreeDecor } from "../../town-world";
import type { WorldDecor } from "../../world";
import { paintHillsGround, touchesHillsGround } from "./hills-ground";
import { townFeetClear } from "./town-path";
import { stumpFrame } from "./wood-tree-renderer";
import { soulFrame } from "../soul/soul-prop-renderer";

type Box = { left: number; top: number; right: number; bottom: number };
type Frame = { w: number; h: number; ax: number; ay: number };
const frameOf = (name: string) => (SOUL_ATLAS.frames as Record<string, Frame | undefined>)[name];
const overlap = (a: Box, b: Box, pad = 0) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;

/** Everything the Town draws in and round Timberwood and along the road out to it from the village. */
const decor = [...new Set([...townWindowDecor((TOWN_GROVE.left + TOWN_GROVE.right) / 2, (TOWN_GROVE.top + TOWN_GROVE.bottom) / 2), ...townWindowDecor(TOWN_WEST_BRIDGE.x, TOWN_WEST_BRIDGE.y)])];
type Prop = Extract<WorldDecor, { type: "soulProp" }>;
const props = decor.filter((item): item is Prop => item.type === "soulProp" && !item.shadow && !item.sheet && !item.signpost);
const standing = props.filter(item => !item.ground);
/** The village's own standing props too (its trees by the river): where each is drawn. */
const villageStanding = decor.filter((item): item is Prop => item.type === "soulProp" && item.sheet === "village" && !item.shadow && !item.ground && !GROVE_LANDING_DECOR.includes(item))
  .map(item => ({ item, box: spriteBox(soulFrame(item.frame, "village")!, item.x, item.y + (item.dy ?? 0), item.s, item.flip) }));
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

  it("draws no tree wider or taller than the layout allows its kind", () => {
    for (const tree of WOOD_TREE_NODES) {
      const box = WOOD_TREE_BOXES[tree.id], spread = WOOD_TREE_SPREAD[tree.kind];
      expect(Math.max(tree.x - box.left, box.right - tree.x), `tree ${tree.id}`).toBeLessThanOrEqual(spread.half);
      expect(tree.y - box.top, `tree ${tree.id}`).toBeLessThanOrEqual(spread.up);
    }
  });

  it("stands its trees in loose clumps, not rows: few share a line, and kinds mingle where stands meet", () => {
    for (const tree of WOOD_TREE_NODES) {
      expect(WOOD_TREE_NODES.filter(other => other.stand === tree.stand && Math.abs(other.y - tree.y) < 15).length, `tree ${tree.id}`).toBeLessThanOrEqual(3);
    }
    const mingled = WOOD_TREE_NODES.filter(tree => WOOD_TREE_NODES.some(other => other.kind !== tree.kind && Math.hypot(other.x - tree.x, other.y - tree.y) < 300));
    expect(mingled.length).toBeGreaterThan(4);
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
    const villageOver = villageStanding.filter(({ box }) => road.some(point => overlap(box, { left: point.x, right: point.x, top: point.y, bottom: point.y }, GROVE_ROAD_HALF_WIDTH)));
    expect(villageOver.map(({ item }) => where(item))).toEqual([]);
  });

  it("ends the road in a landing with logs stacked at its edge, well clear of anyone chopping", () => {
    for (const item of GROVE_LANDING_DECOR) {
      expect(decor).toContain(item);
      expect(Math.hypot(item.x - GROVE_ROAD_END.x, item.y - GROVE_ROAD_END.y)).toBeLessThan(GROVE_LANDING_RADIUS);
      if (item.type !== "soulProp" || item.shadow) continue;
      const frame = soulFrame(item.frame, "village")!, box = spriteBox(frame, item.x, item.y, item.s, item.flip);
      // In front of no one at any tree's chopping spot.
      for (const tree of WOOD_TREE_NODES) for (const spot of WOOD_TREE_SPOTS) {
        const feet = { x: tree.x + spot.x, y: tree.y + spot.y };
        expect(item.y <= feet.y || !overlap(box, { left: feet.x - 22, right: feet.x + 22, top: feet.y - 75, bottom: feet.y })).toBe(true);
      }
    }
  });

  it("stands its sign at the village's edge, where the road comes off the west bridge, pointing west along it with nothing in front of it", () => {
    expect(decor).toContain(TOWN_GROVE_SIGNPOST);
    const sign = TOWN_GROVE_SIGNPOST;
    expect(sign).toMatchObject({ signpost: "Timberwood" });
    expect(sign.type === "soulProp" && sign.flip).toBeFalsy();
    expect(sign.x).toBeLessThan(TOWN_WEST_BRIDGE.x - 154);
    expect(Math.hypot(sign.x - GROVE_ROAD_START.x, sign.y - GROVE_ROAD_START.y)).toBeLessThan(300);
    expect(Math.sqrt(groveRoadDistanceSquared(sign.x, sign.y))).toBeGreaterThan(GROVE_ROAD_HALF_WIDTH + 20);
    expect(townFeetClear(sign.x, sign.y)).toBe(true);
    const plank = { left: sign.x - 80, right: sign.x + 56, top: sign.y - 128, bottom: sign.y + 10 };
    expect(standing.filter(item => item.y > sign.y && overlap(spriteBox(frameOf(item.frame)!, item.x, item.y, item.s, item.flip), plank)).map(where)).toEqual([]);
    expect(villageStanding.filter(({ item, box }) => item.y > sign.y && overlap(box, plank)).map(({ item }) => where(item))).toEqual([]);
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

  it("keeps the grove's trees inside it and inside the walls", () => {
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
      save: () => {}, restore: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {}, arc: () => {},
      fill() { painted.push(context.fillStyle as string); }, stroke() { painted.push(context.strokeStyle as string); },
    };
    const middle = GROVE_ROAD[Math.floor(GROVE_ROAD.length * .7)];
    const rect = { left: middle.x - 256, top: middle.y - 256, right: middle.x + 256, bottom: middle.y + 256 };
    expect(touchesHillsGround(rect)).toBe(true);
    paintHillsGround(context as unknown as CanvasRenderingContext2D, rect, rect.left, rect.top);
    expect([...new Set(painted)]).toEqual(["#7c6044", "#b89474"]);
  });
});
