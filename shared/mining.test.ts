import { describe, expect, it, vi } from "vitest";
import {
  MINING_NODES, MINING_NODE_KINDS, MINING_OUTCROP_GAP, MINING_OUTCROPS, MINING_PLATE_ROOM, MINING_REACH, MINING_ROCK_EXTENT, MINING_ROCK_ROOM,
  MINING_STARSHARD_CHANCE, MINING_TRACK, MINING_TRACK_HALF_WIDTH, MINING_VEINS, miningBreakSeconds, miningGain, miningNode, miningNodeName,
  miningSpeed, miningTrackDistanceSquared, miningVeinMap, miningVeinOpen, miningYield, normalizeMining,
} from "./mining";
import { GRADE_ORES, refineGrade } from "./refine";
import { TOWN_EAST_BRIDGE, TOWN_EAST_FENCE_GAP, TOWN_HILLS, TOWN_VILLAGE_WALK_AREA, TOWN_WALK_AREA } from "./town";
import { ITEM_DEFINITIONS } from "./items";
import { itemTier } from "./item-tier";

describe("the Copper Hills' veins", () => {
  it("run west to east from copper to adamant, edge to edge across the hills", () => {
    expect(MINING_VEINS.map(vein => vein.ore)).toEqual(["copper_ore", "iron_ore", "mithril_ore", "adamant_ore"]);
    expect(MINING_VEINS[0].left).toBe(TOWN_HILLS.left);
    expect(MINING_VEINS.at(-1)!.right).toBe(TOWN_HILLS.right);
    MINING_VEINS.slice(1).forEach((vein, index) => expect(vein.left).toBe(MINING_VEINS[index].right));
    // Each grade twice as hard as the last.
    expect(MINING_VEINS.map(vein => vein.hardness)).toEqual([1, 2, 4, 8]);
    // East of the village's own countryside, and inside the walls, which reach past them.
    expect(TOWN_HILLS.left).toBeGreaterThan(TOWN_VILLAGE_WALK_AREA.right);
    expect(TOWN_WALK_AREA.right).toBeGreaterThan(TOWN_HILLS.right);
    expect([TOWN_WALK_AREA.top, TOWN_WALK_AREA.bottom]).toEqual([TOWN_VILLAGE_WALK_AREA.top, TOWN_VILLAGE_WALK_AREA.bottom]);
    expect(TOWN_HILLS.top).toBeGreaterThan(TOWN_WALK_AREA.top);
    expect(TOWN_HILLS.bottom).toBeLessThan(TOWN_WALK_AREA.bottom);
  });

  it("open with the map whose gear their ore refines", () => {
    for (const vein of MINING_VEINS) {
      // The first tier a vein opens with is the first tier whose gear takes its ore.
      const firstItem = Object.keys(ITEM_DEFINITIONS).find(id => refineGrade(id) && itemTier(id) === vein.firstTier)!;
      expect(GRADE_ORES[refineGrade(firstItem)!]).toBe(vein.ore);
      const before = Object.keys(ITEM_DEFINITIONS).find(id => refineGrade(id) && itemTier(id) === vein.firstTier - 1);
      if (before) expect(GRADE_ORES[refineGrade(before)!]).not.toBe(vein.ore);
    }
    expect(MINING_VEINS.map(miningVeinMap)).toEqual(["Tutorial Forest - 1", "Night Forest - 5", "Moonfen - 9", "Neon Bastion - 13"]);
    const [copper, iron, mithril] = MINING_VEINS;
    expect(miningVeinOpen(copper, null)).toBe(true);
    expect(miningVeinOpen(iron, {})).toBe(false);
    expect(miningVeinOpen(iron, { infernalUnlocked: true })).toBe(true);
    expect(miningVeinOpen(mithril, { infernalUnlocked: true })).toBe(false);
  });
});

describe("the rocks", () => {
  it("are laid the same every time, in their vein's band, apart from each other", () => {
    expect(MINING_NODES.length).toBeGreaterThan(80);
    MINING_NODES.forEach((node, index) => {
      expect(node.id).toBe(index);
      const vein = MINING_VEINS[node.vein];
      expect(node.ore).toBe(vein.ore);
      expect(node.x).toBeGreaterThanOrEqual(vein.left);
      expect(node.x).toBeLessThanOrEqual(vein.right);
      expect(node.y).toBeGreaterThanOrEqual(TOWN_HILLS.top);
      expect(node.y).toBeLessThanOrEqual(TOWN_HILLS.bottom);
    });
    for (const a of MINING_NODES) for (const b of MINING_NODES) if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(80);
  });

  it("are laid from their coordinates alone, the same on every client and the server", async () => {
    vi.resetModules();
    const fresh = await import("./mining");
    expect(fresh.MINING_NODES).not.toBe(MINING_NODES);
    expect(fresh.MINING_NODES).toEqual(MINING_NODES);
  });

  it("come in every kind in every vein: mostly Small, some Large, at least one Mysterious", () => {
    MINING_VEINS.forEach((_vein, veinIndex) => {
      const rocks = MINING_NODES.filter(node => node.vein === veinIndex);
      const count = (kind: string) => rocks.filter(node => node.kind === kind).length;
      expect(count("mysterious")).toBeGreaterThanOrEqual(1);
      expect(count("large")).toBeGreaterThanOrEqual(Math.floor(rocks.length * .2));
      expect(count("small")).toBeGreaterThan(rocks.length / 2);
    });
    // Copper is the biggest vein and adamant the smallest: the deeper, the scarcer.
    const sizes = MINING_VEINS.map((_vein, index) => MINING_NODES.filter(node => node.vein === index).length);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  });

  it("keep their kind's room from each other: none touch, and no spot is in reach of two", () => {
    for (const a of MINING_NODES) for (const b of MINING_NODES) {
      if (a.id >= b.id) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      expect(distance).toBeGreaterThanOrEqual(MINING_ROCK_ROOM[a.kind] + MINING_ROCK_ROOM[b.kind]);
      // A player's feet within reach of one rock are out of reach of every other.
      expect(distance).toBeGreaterThan(2 * MINING_REACH);
    }
  });

  it("stand in outcrops of a few, each in one vein, with room for grass between outcrops", () => {
    expect(MINING_OUTCROPS.flatMap(outcrop => outcrop.rocks).sort((a, b) => a - b)).toEqual(MINING_NODES.map(node => node.id));
    for (const outcrop of MINING_OUTCROPS) {
      expect(outcrop.rocks.length).toBeGreaterThanOrEqual(3);
      expect(outcrop.rocks.length).toBeLessThanOrEqual(8);
      for (const id of outcrop.rocks) expect(MINING_NODES[id].vein).toBe(outcrop.vein);
      // Its heart is one of its big rocks.
      expect(MINING_NODES[outcrop.rocks[0]].kind).not.toBe("small");
    }
    const outcropOf = new Map(MINING_OUTCROPS.flatMap(outcrop => outcrop.rocks.map(id => [id, outcrop.id] as const)));
    for (const a of MINING_NODES) for (const b of MINING_NODES) {
      if (a.id < b.id && outcropOf.get(a.id) !== outcropOf.get(b.id)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(MINING_OUTCROP_GAP);
    }
    // Every vein has a few outcrops, the deeper the fewer.
    const counts = MINING_VEINS.map((_vein, index) => MINING_OUTCROPS.filter(outcrop => outcrop.vein === index).length);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(3);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it("leave the room under each rock free for the plate that names it while it is mined", () => {
    for (const under of MINING_NODES) for (const rock of MINING_NODES) {
      if (rock === under) continue;
      const extent = MINING_ROCK_EXTENT[rock.kind];
      const inRoom = Math.abs(rock.x - under.x) < MINING_PLATE_ROOM.half[under.kind] + extent.half
        && rock.y - extent.up < under.y + MINING_PLATE_ROOM.bottom && rock.y + extent.down > under.y + MINING_PLATE_ROOM.top;
      expect(inRoom, `rock ${rock.id} in rock ${under.id}'s plate room`).toBe(false);
    }
    // The plate hangs below the reach: no miner's feet come that low.
    expect(MINING_PLATE_ROOM.top).toBeGreaterThan(MINING_REACH);
  });

  it("keep off the miners' track, which comes out of the village over the east bridge and ends among the last outcrop", () => {
    const [start, end] = [MINING_TRACK[0], MINING_TRACK.at(-1)!];
    // From just outside the gap in the village's fence, up along it ...
    expect(start.x - TOWN_EAST_FENCE_GAP.right).toBeGreaterThan(0);
    expect(start.x - TOWN_EAST_FENCE_GAP.right).toBeLessThan(60);
    expect(start.y).toBeGreaterThan(TOWN_EAST_FENCE_GAP.top);
    expect(start.y).toBeLessThan(TOWN_EAST_FENCE_GAP.bottom);
    // ... over the east bridge's deck ...
    const onBridge = MINING_TRACK.findIndex(point => point.x >= TOWN_EAST_BRIDGE.x);
    expect(Math.abs(MINING_TRACK[onBridge].y - TOWN_EAST_BRIDGE.y)).toBeLessThan(3);
    // ... and east into the hills at about y 4,220 ...
    const atEdge = MINING_TRACK.find(point => point.x >= TOWN_HILLS.left)!;
    expect(Math.abs(atEdge.y - 4_220)).toBeLessThan(40);
    for (let index = onBridge; index < MINING_TRACK.length; index++) expect(MINING_TRACK[index].x).toBeGreaterThan(MINING_TRACK[index - 1].x);
    // ... and on through every vein to the last, where it ends.
    for (const vein of MINING_VEINS) expect(MINING_TRACK.some(point => point.x > vein.left && point.x < vein.right)).toBe(true);
    expect(end.x).toBeGreaterThan(MINING_VEINS.at(-1)!.left);
    expect(end.x).toBeLessThan(TOWN_HILLS.right);
    // Every rock keeps well off it, but those of the outcrop round its end, which only keep off it.
    const last = MINING_OUTCROPS.filter(outcrop => outcrop.vein === MINING_VEINS.length - 1)
      .sort((a, b) => Math.hypot(a.x - end.x, a.y - end.y) - Math.hypot(b.x - end.x, b.y - end.y))[0];
    expect(Math.hypot(last.x - end.x, last.y - end.y)).toBeLessThan(250);
    for (const node of MINING_NODES) {
      const distance = Math.sqrt(miningTrackDistanceSquared(node.x, node.y));
      expect(distance).toBeGreaterThan(last.rocks.includes(node.id) ? MINING_TRACK_HALF_WIDTH + 60 : 200);
    }
  });

  it("are named as Morkyl named them, and looked up by id", () => {
    const large = MINING_NODES.find(node => node.kind === "large" && node.ore === "iron_ore")!;
    expect(miningNodeName(large)).toBe("Large Iron Ore");
    expect(miningNode(large.id)).toBe(large);
    for (const id of [-1, 1.5, MINING_NODES.length, "3", null]) expect(miningNode(id)).toBeNull();
  });
});

describe("Mining", () => {
  const small = MINING_NODES.find(node => node.kind === "small" && node.ore === "copper_ore")!;
  const large = MINING_NODES.find(node => node.kind === "large" && node.ore === "copper_ore")!;
  const adamant = MINING_NODES.find(node => node.kind === "small" && node.ore === "adamant_ore")!;

  it("makes mining faster, twice as fast at 500 and never three times", () => {
    expect(miningSpeed(0)).toBe(1);
    expect(miningSpeed(500)).toBe(2);
    expect(miningSpeed(1e12)).toBeLessThan(3);
    for (let mining = 0; mining < 5_000; mining += 250) expect(miningSpeed(mining + 250)).toBeGreaterThan(miningSpeed(mining));
    expect([normalizeMining(-5), normalizeMining("12.7"), normalizeMining(NaN)]).toEqual([0, 12, 0]);
  });

  it("times a rock by its kind and vein, and Mining divides the time", () => {
    expect(miningBreakSeconds(small, 0)).toBe(4);
    expect(miningBreakSeconds(large, 0)).toBe(12);
    expect(miningBreakSeconds(adamant, 0)).toBe(32);
    expect(miningBreakSeconds(adamant, 500)).toBe(16);
  });

  it("grows by the ore a rock gives, weighted by how deep its vein is", () => {
    expect([miningGain(small), miningGain(large), miningGain(adamant)]).toEqual([1, 3, 8]);
  });

  it("breaks a rock into its vein's ore, and only a Mysterious rock into a Starshard too", () => {
    const mysterious = MINING_NODES.find(node => node.kind === "mysterious" && node.ore === "mithril_ore")!;
    expect(miningYield(small, 0)).toEqual({ copper_ore: 1 });
    expect(miningYield(large, .5)).toEqual({ copper_ore: 3 });
    expect(miningYield(mysterious, MINING_STARSHARD_CHANCE - .01)).toEqual({ mithril_ore: 2, starshard: 1 });
    expect(miningYield(mysterious, MINING_STARSHARD_CHANCE)).toEqual({ mithril_ore: 2 });
    expect(MINING_NODE_KINDS.mysterious.respawnSeconds).toBeGreaterThan(MINING_NODE_KINDS.large.respawnSeconds);
  });
});
