import { describe, expect, it, vi } from "vitest";
import {
  GROVE_ROAD, GROVE_ROAD_END, GROVE_ROAD_FORK, GROVE_ROAD_HALF_WIDTH, WOOD_STANDS, WOOD_TREE_KINDS, WOOD_TREE_NODES, WOOD_TREES, WOODCUTTING_LOGS,
  WOODCUTTING_REACH, groveRoadDistanceSquared, normalizeWoodcutting, woodcuttingChopSeconds, woodcuttingGain, woodcuttingSpeed, woodcuttingYield,
  woodStandHint, woodStandMap, woodStandOpen, woodTree,
} from "./woodcutting";
import { MINING_TRACK, MINING_VEINS } from "./mining";
import { WOOD_IDS, craftMaterials } from "./crafting";
import { TOWN_GROVE, TOWN_HILLS, TOWN_WALK_AREAS, inTownWalkArea, townChunkProps, townWalkClamp, TOWN_CHUNK_SIZE, inTownGrove } from "./town";

describe("Timberwood's stands", () => {
  it("run west to east from pine to elder, edge to edge across the grove, north of the Copper Hills", () => {
    expect(WOOD_STANDS.map(stand => stand.kind)).toEqual([...WOOD_TREE_KINDS]);
    expect(WOOD_STANDS.map(stand => stand.log)).toEqual([...WOOD_IDS]);
    expect(WOOD_STANDS[0].left).toBe(TOWN_GROVE.left);
    expect(WOOD_STANDS.at(-1)!.right).toBe(TOWN_GROVE.right);
    WOOD_STANDS.slice(1).forEach((stand, index) => expect(stand.left).toBe(WOOD_STANDS[index].right));
    expect(WOOD_STANDS.map(stand => stand.hardness)).toEqual([1, 2, 4, 8]);
    expect(TOWN_GROVE.bottom).toBeLessThan(TOWN_HILLS.top);
    expect(TOWN_GROVE.left).toBeLessThan(TOWN_HILLS.left);
    expect(WOOD_TREES.oak.name).toBe("Oak Tree");
  });

  it("open with the same maps as the ore veins whose grade their wood crafts with", () => {
    expect(WOOD_STANDS.map(stand => stand.firstTier)).toEqual(MINING_VEINS.map(vein => vein.firstTier));
    expect(WOOD_STANDS.map(woodStandMap)).toEqual(["Tutorial Forest - 1", "Night Forest - 5", "Moonfen - 9", "Neon Bastion - 13"]);
    const [pine, oak, yew] = WOOD_STANDS;
    expect(woodStandOpen(pine, null)).toBe(true);
    expect(woodStandOpen(oak, {})).toBe(false);
    expect(woodStandOpen(oak, { infernalUnlocked: true })).toBe(true);
    expect(woodStandOpen(yew, { infernalUnlocked: true })).toBe(false);
    expect(woodStandHint(oak)).toBe("Reach Night Forest - 5 to chop Oak Trees.");
    // Each stand's wood is the wood its grade's crafts take.
    expect(Object.keys(craftMaterials("uncommon", "bow"))).toContain(oak.log);
  });
});

describe("the trees", () => {
  it("are laid the same every time, in their stand's band inside the grove, the deeper the fewer", async () => {
    WOOD_TREE_NODES.forEach((tree, index) => {
      expect(tree.id).toBe(index);
      const stand = WOOD_STANDS[tree.stand];
      expect([tree.kind, tree.log]).toEqual([stand.kind, stand.log]);
      expect(tree.x).toBeGreaterThan(stand.left);
      expect(tree.x).toBeLessThan(stand.right);
      expect(inTownGrove(tree.x, tree.y)).toBe(true);
    });
    expect(WOOD_STANDS.map((_stand, index) => WOOD_TREE_NODES.filter(tree => tree.stand === index).length)).toEqual(WOOD_STANDS.map(stand => stand.trees));
    vi.resetModules();
    const fresh = await import("./woodcutting");
    expect(fresh.WOOD_TREE_NODES).not.toBe(WOOD_TREE_NODES);
    expect(fresh.WOOD_TREE_NODES).toEqual(WOOD_TREE_NODES);
  });

  it("keep apart: no spot is in reach of two", () => {
    for (const a of WOOD_TREE_NODES) for (const b of WOOD_TREE_NODES) {
      if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * WOODCUTTING_REACH + 30);
    }
  });

  it("are looked up by id", () => {
    expect(woodTree(3)).toBe(WOOD_TREE_NODES[3]);
    for (const id of [-1, 1.5, WOOD_TREE_NODES.length, "3", null]) expect(woodTree(id)).toBeNull();
  });
});

describe("the woodcutters' road", () => {
  it("forks off the miners' track and ends just west of the pines, the trees well off it", () => {
    expect(MINING_TRACK).toContainEqual(GROVE_ROAD_FORK);
    expect(GROVE_ROAD[0]).toEqual(GROVE_ROAD_FORK);
    expect(GROVE_ROAD.at(-1)).toEqual(GROVE_ROAD_END);
    expect(inTownGrove(GROVE_ROAD_END.x, GROVE_ROAD_END.y)).toBe(true);
    const pines = WOOD_TREE_NODES.filter(tree => tree.kind === "pine");
    expect(Math.min(...pines.map(tree => tree.x))).toBeGreaterThan(GROVE_ROAD_END.x + 150);
    for (const tree of WOOD_TREE_NODES) expect(Math.sqrt(groveRoadDistanceSquared(tree.x, tree.y))).toBeGreaterThan(GROVE_ROAD_HALF_WIDTH + 150);
    // Every step of it is inside the walls.
    for (const point of GROVE_ROAD) expect(inTownWalkArea(point.x, point.y)).toBe(true);
  });
});

describe("the walls round Timberwood", () => {
  it("hold the grove and join the hills' walls along their north edge", () => {
    const [east, grove] = TOWN_WALK_AREAS;
    expect(grove.left).toBeLessThan(TOWN_GROVE.left);
    expect(grove.top).toBeLessThan(TOWN_GROVE.top);
    expect(grove.bottom).toBeGreaterThan(east.top);
    for (const tree of WOOD_TREE_NODES) expect(inTownWalkArea(tree.x, tree.y + 44)).toBe(true);
    // North of the village stays walled.
    expect(inTownWalkArea(east.left + 100, east.top - 100)).toBe(false);
    expect(townWalkClamp(east.left + 100, east.top - 100)).toEqual({ x: east.left + 100, y: east.top });
    expect(townWalkClamp(TOWN_GROVE.left + 10, TOWN_GROVE.top + 10)).toEqual({ x: TOWN_GROVE.left + 10, y: TOWN_GROVE.top + 10 });
  });

  it("keep the countryside's own props out of the grove", () => {
    for (let cx = Math.floor(TOWN_GROVE.left / TOWN_CHUNK_SIZE); cx <= Math.floor(TOWN_GROVE.right / TOWN_CHUNK_SIZE); cx++) {
      for (let cy = Math.floor(TOWN_GROVE.top / TOWN_CHUNK_SIZE); cy <= Math.floor(TOWN_GROVE.bottom / TOWN_CHUNK_SIZE); cy++) {
        expect(townChunkProps(cx, cy).filter(prop => inTownGrove(prop.x, prop.y))).toEqual([]);
      }
    }
  });
});

describe("Woodcutting", () => {
  const pine = WOOD_TREE_NODES.find(tree => tree.kind === "pine")!, elder = WOOD_TREE_NODES.find(tree => tree.kind === "elder")!;

  it("makes chopping faster as Mining makes mining faster", () => {
    expect([woodcuttingSpeed(0), woodcuttingSpeed(500)]).toEqual([1, 2]);
    expect(woodcuttingSpeed(1e12)).toBeLessThan(3);
    expect([normalizeWoodcutting(-5), normalizeWoodcutting("12.7"), normalizeWoodcutting(NaN)]).toEqual([0, 12, 0]);
    expect(woodcuttingChopSeconds(pine, 0)).toBe(8);
    expect(woodcuttingChopSeconds(elder, 0)).toBe(64);
    expect(woodcuttingChopSeconds(elder, 500)).toBe(32);
  });

  it("fells a tree into its stand's logs, and grows by them weighted by how deep the stand is", () => {
    expect(woodcuttingYield(pine)).toEqual({ pine_log: WOODCUTTING_LOGS });
    expect(woodcuttingYield(elder)).toEqual({ elder_log: WOODCUTTING_LOGS });
    expect([woodcuttingGain(pine), woodcuttingGain(elder)]).toEqual([WOODCUTTING_LOGS, WOODCUTTING_LOGS * 8]);
  });
});
