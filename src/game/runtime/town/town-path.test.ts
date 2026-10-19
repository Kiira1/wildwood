import { describe, expect, it, vi } from "vitest";
import { MINING_NODES } from "../../../../shared/mining";
import {
  TOWN_ARRIVAL, TOWN_CENTER, TOWN_DOORS, TOWN_EAST_BRIDGE, TOWN_EAST_FENCE_GAP, TOWN_FEET_OFFSET, TOWN_GROVE, TOWN_HILLS, TOWN_WALK_AREAS, TOWN_WEST_BRIDGE, inTownGrove,
  townRoomAt, townWalkClamp,
} from "../../../../shared/town";
import { GROVE_ROAD_END, GROVE_ROAD_GATE, GROVE_ROAD_START, WOOD_STANDS, WOOD_TREE_NODES, WOODCUTTING_REACH, groveRoadDistanceSquared, type WoodTree } from "../../../../shared/woodcutting";
import { miningStandSpot } from "../auto-farm/auto-mine";
import { planTownPath, townFeetClear, type TownPoint } from "./town-path";
import { pushOutOf, TOWN_FEET_RADIUS, TOWN_SOLIDS } from "./town-runtime";

// Whole walks across the Town, step by step: a second or so each, more on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const arrival = { x: TOWN_ARRIVAL.x, y: TOWN_ARRIVAL.y + TOWN_FEET_OFFSET };
const firstCopper = MINING_NODES.find(node => node.ore === "copper_ore")!;
const lastAdamant = MINING_NODES.filter(node => node.ore === "adamant_ore").at(-1)!;

/**
 * Walks feet along the waypoints as the Town moves a player: a small step at a time, pushed out of every solid
 * and held inside the walls. Where they end up.
 */
function walk(from: TownPoint, waypoints: readonly TownPoint[]) {
  const feet = { ...from, r: TOWN_FEET_RADIUS };
  for (const waypoint of waypoints) {
    for (let step = 0; step < 4_000; step++) {
      const dx = waypoint.x - feet.x, dy = waypoint.y - feet.y, distance = Math.hypot(dx, dy);
      if (distance < 1) break;
      const move = Math.min(distance, 5);
      feet.x += dx / distance * move; feet.y += dy / distance * move;
      for (const solid of TOWN_SOLIDS) pushOutOf(feet, solid);
      if (!townRoomAt(feet.x, feet.y - TOWN_FEET_OFFSET, 400)) Object.assign(feet, townWalkClamp(feet.x, feet.y));
    }
  }
  return { x: feet.x, y: feet.y };
}
/** Where feet stand to chop a tree: in front of it, else to either side, in its reach, as a rock's (miningStandSpot). */
const treeStandSpot = (tree: WoodTree) => ([[0, 44], [-44, 34], [44, 34]] as const).map(([dx, dy]) => ({ x: tree.x + dx, y: tree.y + dy }))
  .find(at => Math.hypot(at.x - tree.x, at.y - tree.y) < WOODCUTTING_REACH - 8 && townFeetClear(at.x, at.y)) ?? null;
/** Where the walk crosses the line x = `at`, going east. */
const crossings = (from: TownPoint, waypoints: readonly TownPoint[], at: number) => [from, ...waypoints].slice(1).flatMap((to, index) => {
  const a = [from, ...waypoints][index];
  return a.x <= at && to.x > at ? [a.y + (to.y - a.y) * (at - a.x) / (to.x - a.x)] : [];
});

describe("walks planned through the Town", () => {
  it("goes from where everyone lands out through the east gap, over the bridge and on to a copper rock", () => {
    const goal = miningStandSpot(firstCopper)!;
    const path = planTownPath(arrival, goal)!;
    expect(path).not.toBeNull();
    expect(path.at(-1)).toEqual(goal);
    // Through the gap in the fence, and over the river on the bridge's deck between its railings.
    for (const y of crossings(arrival, path, TOWN_EAST_FENCE_GAP.left + 30)) {
      expect(y).toBeGreaterThan(TOWN_EAST_FENCE_GAP.top);
      expect(y).toBeLessThan(TOWN_EAST_FENCE_GAP.bottom);
    }
    expect(crossings(arrival, path, TOWN_EAST_FENCE_GAP.left + 30)).toHaveLength(1);
    const overRiver = crossings(arrival, path, TOWN_EAST_BRIDGE.x);
    expect(overRiver).toHaveLength(1);
    expect(Math.abs(overRiver[0] - TOWN_EAST_BRIDGE.y)).toBeLessThan(34);
    // Walked as the Town moves a player, it arrives.
    const end = walk(arrival, path);
    expect(Math.hypot(end.x - goal.x, end.y - goal.y)).toBeLessThan(2);
  });

  it("reaches the deepest adamant rock the same way, in a handful of straight stretches", () => {
    const goal = miningStandSpot(lastAdamant)!;
    const path = planTownPath(arrival, goal)!;
    expect(path.length).toBeLessThan(20);
    expect(crossings(arrival, path, TOWN_EAST_BRIDGE.x).map(y => Math.abs(y - TOWN_EAST_BRIDGE.y) < 34)).toEqual([true]);
    const end = walk(arrival, path);
    expect(Math.hypot(end.x - goal.x, end.y - goal.y)).toBeLessThan(2);
  });

  it("comes from the far side of the village and from inside the hills too", () => {
    for (const from of [{ x: TOWN_CENTER.x - 2_300, y: TOWN_CENTER.y + 1_700 }, miningStandSpot(firstCopper)!]) {
      expect(townFeetClear(from.x, from.y)).toBe(true);
      const goal = miningStandSpot(lastAdamant)!, path = planTownPath(from, goal)!;
      const end = walk(from, path);
      expect(Math.hypot(end.x - goal.x, end.y - goal.y)).toBeLessThan(2);
    }
  });

  it("goes out west over the village's west bridge to Timberwood, to a tree in every stand", () => {
    for (const stand of WOOD_STANDS.map((_stand, index) => index)) {
      const trees = WOOD_TREE_NODES.filter(tree => tree.stand === stand);
      for (const tree of [trees[0], trees.at(-1)!]) {
        const goal = treeStandSpot(tree)!;
        expect(goal, `tree ${tree.id}`).not.toBeNull();
        const path = planTownPath(arrival, goal)!;
        expect(path, `tree ${tree.id}`).not.toBeNull();
        // Over the river on the west bridge's deck, between its railings.
        const overRiver = crossings(goal, [...path].reverse().slice(1).concat(arrival), TOWN_WEST_BRIDGE.x);
        expect(overRiver, `tree ${tree.id}`).toHaveLength(1);
        expect(Math.abs(overRiver[0] - TOWN_WEST_BRIDGE.y), `tree ${tree.id}`).toBeLessThan(34);
        const end = walk(arrival, path);
        expect(Math.hypot(end.x - goal.x, end.y - goal.y), `tree ${tree.id}`).toBeLessThan(2);
      }
    }
  });

  it("walks the woodcutters' road from the west bridge into the grove and on to its end", () => {
    const path = planTownPath(GROVE_ROAD_START, GROVE_ROAD_GATE)!;
    // Along the road to where it comes into the grove, never far off it; then on to its end among the yews.
    for (const point of path) expect(Math.sqrt(groveRoadDistanceSquared(point.x, point.y))).toBeLessThan(160);
    const end = walk(GROVE_ROAD_START, path);
    expect(Math.hypot(end.x - GROVE_ROAD_GATE.x, end.y - GROVE_ROAD_GATE.y)).toBeLessThan(2);
    const deeper = walk(end, planTownPath(end, GROVE_ROAD_END)!);
    expect(Math.hypot(deeper.x - GROVE_ROAD_END.x, deeper.y - GROVE_ROAD_END.y)).toBeLessThan(2);
  });

  it("keeps the walls round the village and the hills where they were, north of them too", () => {
    const [walls] = TOWN_WALK_AREAS;
    expect(townFeetClear(TOWN_CENTER.x, walls.top - 200)).toBe(false);
    expect(townFeetClear(TOWN_HILLS.left + 1_500, TOWN_HILLS.top - 600)).toBe(false);
    expect(townFeetClear(TOWN_GROVE.left + 500, TOWN_GROVE.top + 300)).toBe(true);
    expect(inTownGrove(GROVE_ROAD_END.x, GROVE_ROAD_END.y)).toBe(true);
  });

  it("walks out of a house's room to its doorway", () => {
    const door = TOWN_DOORS[5], from = { x: door.inside.x, y: door.inside.y + TOWN_FEET_OFFSET - 40 };
    const doorway = { x: door.exit.x, y: door.exit.y - 14 };
    const path = planTownPath(from, doorway)!;
    expect(path).not.toBeNull();
    const end = walk(from, path);
    expect(Math.hypot(end.x - doorway.x, end.y - doorway.y)).toBeLessThan(2);
  });

  it("finds no way to a spot nobody can stand on, or one walled off from the start", () => {
    // In the river beside the bridge.
    expect(townFeetClear(TOWN_EAST_BRIDGE.x, TOWN_EAST_BRIDGE.y + 120)).toBe(false);
    expect(planTownPath(arrival, { x: TOWN_EAST_BRIDGE.x, y: TOWN_EAST_BRIDGE.y + 120 })).toBeNull();
    // A house's room is through its door, not across the village.
    const room = TOWN_DOORS[5].room;
    const inside = { x: (room.left + room.right) / 2, y: room.bottom - 60 };
    expect(townFeetClear(inside.x, inside.y)).toBe(true);
    expect(planTownPath(arrival, inside)).toBeNull();
  });

  it("plans the walk out to the hills in a few milliseconds", () => {
    const goals = [miningStandSpot(firstCopper)!, miningStandSpot(lastAdamant)!];
    for (const goal of goals) planTownPath(arrival, goal);
    const times: number[] = [];
    for (let round = 0; round < 10; round++) for (const goal of goals) {
      const started = performance.now();
      planTownPath(arrival, goal);
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(10);
  });
});
