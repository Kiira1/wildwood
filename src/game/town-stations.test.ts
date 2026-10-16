import { describe, expect, it, vi } from "vitest";
vi.mock("../app/developer", () => ({ isDeveloperIdentity: () => false }));
import { HOME_BENCH_POSITION, HOME_QUEST_BOARD_POSITION, HOME_RESEARCH_POSITION } from "../../shared/home";
import { MINING_TRACK, miningTrackDistanceSquared } from "../../shared/mining";
import { TOWN_ARRIVAL, TOWN_BENCH_POSITION, TOWN_CENTER, TOWN_DOORS, TOWN_EAST_BRIDGE, TOWN_EAST_BRIDGE_APPROACHES, TOWN_EAST_FENCE_GAP, TOWN_EAST_FENCE_GAP_OUTSIDE, TOWN_FEET_OFFSET, TOWN_OX_POSITION, TOWN_QUEST_BOARD_POSITION, TOWN_RESEARCH_POSITION, TOWN_SMITH_POSITION, TOWN_SMITH_REACH, TOWN_SMITH_SERVER_REACH, TOWN_TRAVEL_PORTAL, inTownVillage, townRoomAt } from "../../shared/town";
import { SOUL_INTERIOR_DECOR, SOUL_INTERIOR_SOLIDS, SOUL_VILLAGE_DECOR, SOUL_VILLAGE_SOLIDS } from "./soul-village";
import { TOWN_HILLS_SIGNPOST, TOWN_SIGNPOST, townWindowDecor } from "./town-world";
import { UPGRADE_BENCH_POSITION } from "./world";
import { pushOutOf } from "./runtime/town/town-runtime";
import { createHomeStationTouchHandler } from "../ui/game-ui-runtime";
import { playerTouchesUpgradeBench } from "../ui/upgrade-bench-controller";
import { MAP_ASSET_GROUPS } from "./runtime/render/map-asset-groups";

// Several tests walk a whole route through the Town step by step: seconds each, more on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const STATIONS = [
  { label: "Upgrade Bench", at: TOWN_BENCH_POSITION, door: 6 },
  { label: "Tech Research", at: TOWN_RESEARCH_POSITION, door: 1 },
  { label: "Quest Board", at: TOWN_QUEST_BOARD_POSITION, door: 5 },
] as const;
/** Where a player stands to use each station: on the floor in front of it. */
const SPOTS = { "Upgrade Bench": { dx: 0, dy: -35 }, "Tech Research": { dx: 0, dy: -25 }, "Quest Board": { dx: 0, dy: -14 } } as const;

/** The stations and people drawn in the decor window around a point, by label. */
const stationLabels = (at: { x: number; y: number }) => townWindowDecor(at.x, at.y).flatMap(item => (item.type === "upgradeBench" ? [item.label] : []));

const FEET_RADIUS = 12;
/** Whether a player standing here is clear of every wall and piece of furniture. */
function standable(x: number, y: number) {
  const feet = { x, y: y + TOWN_FEET_OFFSET, r: FEET_RADIUS };
  return [...SOUL_VILLAGE_SOLIDS, ...SOUL_INTERIOR_SOLIDS].every(solid => {
    const probe = { ...feet };
    pushOutOf(probe, solid);
    return Math.hypot(probe.x - feet.x, probe.y - feet.y) < .01;
  });
}
/** Walks a coarse grid from the room's doorway: can a player get from it to the spot? */
function reachable(door: number, to: { x: number; y: number }) {
  const { room, inside } = TOWN_DOORS[door];
  const step = 6, key = (x: number, y: number) => `${x},${y}`;
  const start = { x: inside.x, y: inside.y }, seen = new Set([key(start.x, start.y)]), queue = [start];
  while (queue.length) {
    const at = queue.shift()!;
    if (Math.hypot(at.x - to.x, at.y - to.y) <= step) return true;
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const x = at.x + dx, y = at.y + dy;
      if (seen.has(key(x, y)) || x < room.left || x > room.right || y < room.top - TOWN_FEET_OFFSET || y > room.bottom) continue;
      seen.add(key(x, y));
      if (standable(x, y)) queue.push({ x, y });
    }
  }
  return false;
}

describe("Home's stations in the Town's buildings", () => {
  it("stands each station in its room, drawn with the room's furniture", () => {
    for (const { label, at, door } of STATIONS) {
      expect(townRoomAt(at.x, at.y)).toBe(TOWN_DOORS[door]);
      const decor = townWindowDecor(at.x, at.y);
      expect(decor).toContainEqual(expect.objectContaining({ type: "upgradeBench", x: at.x, y: at.y, label }));
    }
    // Out in the village, the rooms' stations are not in the window: only the Smith, who works outdoors.
    expect(stationLabels(TOWN_ARRIVAL)).toEqual(["Smith"]);
  });
  it("takes the place of one piece of furniture each, and overlaps no other", () => {
    const decor = townWindowDecor(TOWN_BENCH_POSITION.x, TOWN_BENCH_POSITION.y);
    const interior = decor.filter(item => item.type === "soulProp");
    expect(SOUL_INTERIOR_DECOR.length - interior.length).toBe(6); // three props and their three shadows
    for (const { at } of STATIONS) {
      // No remaining standing furniture within the station's footprint (about 180 wide, against the back wall).
      const crowding = interior.filter(item => item.type === "soulProp" && !item.shadow && Math.abs(item.x - at.x) < 90 && item.y > at.y - 40 && item.y < at.y + 20);
      expect(crowding).toEqual([]);
    }
  });
  it("lets a player walk in from the door and open each station from in front of it", () => {
    const openResearch = vi.fn(), openBoard = vi.fn(), updateBench = vi.fn();
    const player = { x: 0, y: 0 };
    let inTown = true;
    const touch = createHomeStationTouchHandler(() => inTown, player, openResearch, updateBench, openBoard);
    for (const { label, at, door } of STATIONS) {
      const spot = { x: at.x + SPOTS[label].dx, y: at.y + SPOTS[label].dy };
      expect(standable(spot.x, spot.y)).toBe(true);
      expect(reachable(door, spot)).toBe(true);
      Object.assign(player, spot);
      touch();
      if (label === "Upgrade Bench") {
        expect(playerTouchesUpgradeBench(player, UPGRADE_BENCH_POSITION)).toBe(true);
        // Inside the server's reach check (75 from the bench's point).
        expect(Math.hypot(player.x - TOWN_BENCH_POSITION.x, player.y - TOWN_BENCH_POSITION.y)).toBeLessThan(75);
      }
      player.x = TOWN_DOORS[door].inside.x; player.y = TOWN_DOORS[door].inside.y; touch();
    }
    expect(openResearch).toHaveBeenCalledOnce();
    expect(openBoard).toHaveBeenCalledOnce();
    // The furniture each station replaced keeps its collider, as the station's: no walking through the bench.
    expect(standable(TOWN_BENCH_POSITION.x, TOWN_BENCH_POSITION.y - 25 - TOWN_FEET_OFFSET)).toBe(false);
    expect(reachable(6, { x: TOWN_BENCH_POSITION.x, y: TOWN_BENCH_POSITION.y - 25 - TOWN_FEET_OFFSET })).toBe(false);
    expect(UPGRADE_BENCH_POSITION).toBe(TOWN_BENCH_POSITION);
    // Home's old spots open nothing, in the Town or anywhere else.
    for (const at of [HOME_RESEARCH_POSITION, HOME_QUEST_BOARD_POSITION]) { player.x = at.x; player.y = at.y - 30; touch(); }
    inTown = false;
    player.x = TOWN_RESEARCH_POSITION.x; player.y = TOWN_RESEARCH_POSITION.y - 25; touch();
    expect(openResearch).toHaveBeenCalledOnce();
    expect(openBoard).toHaveBeenCalledOnce();
    expect(playerTouchesUpgradeBench({ x: HOME_BENCH_POSITION.x, y: HOME_BENCH_POSITION.y - 36 }, UPGRADE_BENCH_POSITION)).toBe(false);
  });
  it("loads the bench's sprite with the Town's art", () => {
    expect(MAP_ASSET_GROUPS.town.art).toContain("snowDecor");
  });
});

describe("Ox in the bottom-right house", () => {
  it("stands in door 8's room, the village's furthest south-east, on open floor a player can walk to", () => {
    const southEast = [...TOWN_DOORS].sort((a, b) => (b.x + b.y) - (a.x + a.y))[0];
    expect(southEast.index).toBe(8);
    expect(townRoomAt(TOWN_OX_POSITION.x, TOWN_OX_POSITION.y)).toBe(TOWN_DOORS[8]);
    expect(townWindowDecor(TOWN_OX_POSITION.x, TOWN_OX_POSITION.y)).toContainEqual(expect.objectContaining({ type: "upgradeBench", label: "Ox" }));
    // His feet are on the floor itself, clear of the furniture.
    expect(standable(TOWN_OX_POSITION.x, TOWN_OX_POSITION.y - TOWN_FEET_OFFSET)).toBe(true);
    expect(reachable(8, { x: TOWN_OX_POSITION.x, y: TOWN_OX_POSITION.y - TOWN_FEET_OFFSET })).toBe(true);
  });
  it("opens his shop once as a player walks up, and again only after they step away", () => {
    const openOx = vi.fn(), player = { x: TOWN_DOORS[8].inside.x, y: TOWN_DOORS[8].inside.y };
    let inTown = true;
    const touch = createHomeStationTouchHandler(() => inTown, player, vi.fn(), vi.fn(), vi.fn(), openOx);
    touch();
    expect(openOx).not.toHaveBeenCalled();
    Object.assign(player, { x: TOWN_OX_POSITION.x + 40, y: TOWN_OX_POSITION.y - TOWN_FEET_OFFSET });
    touch(); touch();
    expect(openOx).toHaveBeenCalledOnce();
    Object.assign(player, TOWN_DOORS[8].inside); touch();
    Object.assign(player, { x: TOWN_OX_POSITION.x - 40, y: TOWN_OX_POSITION.y - TOWN_FEET_OFFSET }); touch();
    expect(openOx).toHaveBeenCalledTimes(2);
    inTown = false;
    Object.assign(player, TOWN_DOORS[8].inside); touch();
    Object.assign(player, { x: TOWN_OX_POSITION.x, y: TOWN_OX_POSITION.y - TOWN_FEET_OFFSET }); touch();
    expect(openOx).toHaveBeenCalledTimes(2);
  });
});

/** Walks a coarse grid across the village from one spot: can a player get within `reach` of another? */
function walkable(from: { x: number; y: number }, to: { x: number; y: number }, reach: number) {
  const step = 8, key = (x: number, y: number) => `${x},${y}`;
  const box = { left: Math.min(from.x, to.x) - 200, right: Math.max(from.x, to.x) + 200, top: Math.min(from.y, to.y) - 200, bottom: Math.max(from.y, to.y) + 200 };
  const start = { x: Math.round(from.x), y: Math.round(from.y) }, seen = new Set([key(start.x, start.y)]), queue = [start];
  while (queue.length) {
    const at = queue.shift()!;
    if (Math.hypot(at.x - to.x, at.y - to.y) <= reach) return true;
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const x = at.x + dx, y = at.y + dy;
      if (seen.has(key(x, y)) || x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      seen.add(key(x, y));
      if (standable(x, y)) queue.push({ x, y });
    }
  }
  return false;
}

describe("the Smith at the forge house", () => {
  // Where a player stands when he is in reach: his own spot, the way the player's position is measured.
  const stand = { x: TOWN_SMITH_POSITION.x, y: TOWN_SMITH_POSITION.y - TOWN_FEET_OFFSET };
  it("works outdoors in the village, right of the Upgrade Bench's building, drawn with the village", () => {
    expect(inTownVillage(TOWN_SMITH_POSITION.x, TOWN_SMITH_POSITION.y)).toBe(true);
    expect(townRoomAt(TOWN_SMITH_POSITION.x, TOWN_SMITH_POSITION.y)).toBeNull();
    // The forge house is the next building right of door 6, a little further down the square.
    expect(TOWN_SMITH_POSITION.x - TOWN_DOORS[6].x).toBeGreaterThan(100);
    expect(TOWN_SMITH_POSITION.x - TOWN_DOORS[6].x).toBeLessThan(260);
    expect(townWindowDecor(TOWN_SMITH_POSITION.x, TOWN_SMITH_POSITION.y)).toContainEqual(expect.objectContaining({ type: "upgradeBench", label: "Smith" }));
    expect(stationLabels(TOWN_BENCH_POSITION)).not.toContain("Smith");
  });
  it("stands on open ground a player can walk to from where everyone lands", () => {
    expect(standable(stand.x, stand.y)).toBe(true);
    expect(walkable(TOWN_ARRIVAL, stand, TOWN_SMITH_REACH * .8)).toBe(true);
  });
  it("opens his window once as a player walks up, again only after they step away, and the server agrees they are in reach", () => {
    const openSmith = vi.fn(), player = { x: TOWN_ARRIVAL.x, y: TOWN_ARRIVAL.y };
    let inTown = true;
    const touch = createHomeStationTouchHandler(() => inTown, player, vi.fn(), vi.fn(), vi.fn(), vi.fn(), openSmith);
    touch();
    expect(openSmith).not.toHaveBeenCalled();
    // In from the road on his left, as the yard is entered.
    Object.assign(player, { x: stand.x - 50, y: stand.y });
    touch(); touch();
    expect(openSmith).toHaveBeenCalledOnce();
    expect(Math.hypot(player.x - stand.x, player.y - stand.y)).toBeLessThanOrEqual(TOWN_SMITH_SERVER_REACH);
    Object.assign(player, TOWN_ARRIVAL); touch();
    Object.assign(player, { x: stand.x - 40, y: stand.y }); touch();
    expect(openSmith).toHaveBeenCalledTimes(2);
    inTown = false;
    Object.assign(player, TOWN_ARRIVAL); touch();
    Object.assign(player, stand); touch();
    expect(openSmith).toHaveBeenCalledTimes(2);
  });
});

describe("the way out east, to the Copper Hills", () => {
  const gapMiddle = (TOWN_EAST_FENCE_GAP.top + TOWN_EAST_FENCE_GAP.bottom) / 2;
  const within = (area: { left: number; right: number; top: number; bottom: number }, x: number, y: number) =>
    x > area.left && x < area.right && y > area.top && y < area.bottom;

  it("goes through a gap in the fence east of the Inn, with nothing standing in it or just outside it", () => {
    // From where everyone lands, out through the gap and on east.
    expect(walkable(TOWN_ARRIVAL, { x: TOWN_EAST_FENCE_GAP.right + 140, y: gapMiddle - TOWN_FEET_OFFSET }, 10)).toBe(true);
    // Open all the way across, fence line and all.
    for (let x = TOWN_EAST_FENCE_GAP.left - 40; x <= TOWN_EAST_FENCE_GAP.right + 60; x += 10) expect(standable(x, gapMiddle - TOWN_FEET_OFFSET), `at ${x}`).toBe(true);
    // The tall tree that stood in the way out, hiding whoever walked through, is gone with its shadow.
    const standingThere = SOUL_VILLAGE_DECOR.filter(item => item.type === "soulProp" && !item.ground
      && (within(TOWN_EAST_FENCE_GAP, item.x, item.y) || within(TOWN_EAST_FENCE_GAP_OUTSIDE, item.x, item.y)));
    expect(standingThere).toEqual([]);
  });

  it("crosses the river on a bridge north-east of the gap, with the miners' track over its deck", () => {
    const deckY = TOWN_EAST_BRIDGE.y - TOWN_FEET_OFFSET;
    // From just outside the gap to the far bank, within 200 of the two: not the long way round the river's head.
    expect(walkable({ x: TOWN_EAST_FENCE_GAP.right + 40, y: gapMiddle - TOWN_FEET_OFFSET }, { x: TOWN_EAST_BRIDGE.x + 220, y: deckY }, 10)).toBe(true);
    // Open from bank to bank between its railings, with the river on either side of it.
    for (let x = TOWN_EAST_BRIDGE.x - 130; x <= TOWN_EAST_BRIDGE.x + 130; x += 10) expect(standable(x, deckY), `deck at ${x}`).toBe(true);
    for (const dy of [-37, 36, -60, 60, -120, 120]) expect(standable(TOWN_EAST_BRIDGE.x + 20, deckY + dy), `off the deck by ${dy}`).toBe(false);
    // The track crosses on the deck.
    const crossing = MINING_TRACK.filter(point => Math.abs(point.x - TOWN_EAST_BRIDGE.x) <= TOWN_EAST_BRIDGE.halfWidth && Math.abs(point.y - TOWN_EAST_BRIDGE.y) < 300);
    expect(crossing.length).toBeGreaterThan(5);
    for (const point of crossing) expect(Math.abs(point.y - TOWN_EAST_BRIDGE.y), `${point.x},${point.y}`).toBeLessThanOrEqual(2);
    // The deck is drawn with the village, and the trees that hid the way up to it and off it are gone, shadows and all.
    expect(SOUL_VILLAGE_DECOR.filter(item => item.type === "soulProp" && item.ground && Math.abs(item.y - TOWN_EAST_BRIDGE.y) < 1 && Math.abs(item.x - TOWN_EAST_BRIDGE.x) < 80))
      .toHaveLength(2);
    const approaches = SOUL_VILLAGE_DECOR.filter(item => item.type === "soulProp" && !item.ground
      && TOWN_EAST_BRIDGE_APPROACHES.some(area => within(area, item.x, item.y)));
    expect(approaches).toEqual([]);
    // Nothing of the village's grows on the track.
    const onTrack = SOUL_VILLAGE_DECOR.filter(item => item.type === "soulProp" && item.ground && !(Math.abs(item.y - TOWN_EAST_BRIDGE.y) < 1)
      && miningTrackDistanceSquared(item.x, item.y, 60) < 54 ** 2);
    expect(onTrack).toEqual([]);
  });

  it("is signed just outside the gap, below its south post, pointing east, on open ground", () => {
    expect(townWindowDecor(TOWN_ARRIVAL.x, TOWN_ARRIVAL.y)).toContain(TOWN_HILLS_SIGNPOST);
    expect(TOWN_HILLS_SIGNPOST).toMatchObject({ type: "soulProp", signpost: "Copper Hills", flip: true });
    // Outside the fence, beside the gap's south end: seen from the square through the gap, and in passing.
    expect(TOWN_HILLS_SIGNPOST.x).toBeGreaterThan(TOWN_EAST_FENCE_GAP.right);
    expect(TOWN_HILLS_SIGNPOST.x - TOWN_EAST_FENCE_GAP.right).toBeLessThan(80);
    expect(TOWN_HILLS_SIGNPOST.y).toBeGreaterThan(TOWN_EAST_FENCE_GAP.bottom);
    expect(TOWN_HILLS_SIGNPOST.y - TOWN_EAST_FENCE_GAP.bottom).toBeLessThan(100);
    expect(within(TOWN_EAST_FENCE_GAP_OUTSIDE, TOWN_HILLS_SIGNPOST.x, TOWN_HILLS_SIGNPOST.y)).toBe(true);
    // Its post stands on open ground, out of the way of whoever walks through the gap.
    expect(standable(TOWN_HILLS_SIGNPOST.x, TOWN_HILLS_SIGNPOST.y - TOWN_FEET_OFFSET)).toBe(true);
    expect(TOWN_HILLS_SIGNPOST.y - gapMiddle).toBeGreaterThan(120);
  });
});

describe("the Town square's signpost", () => {
  it("stands near where everyone lands, clear of the fountain and the doors, pointing at the travel portal", () => {
    const decor = townWindowDecor(TOWN_ARRIVAL.x, TOWN_ARRIVAL.y);
    expect(decor).toContain(TOWN_SIGNPOST);
    expect(TOWN_SIGNPOST).toMatchObject({ type: "soulProp", signpost: "Travel" });
    // In sight on landing, but far enough off that the arriving player's own name label does not cover its plank.
    const fromArrival = Math.hypot(TOWN_SIGNPOST.x - TOWN_ARRIVAL.x, TOWN_SIGNPOST.y - TOWN_ARRIVAL.y);
    expect(fromArrival).toBeGreaterThan(180);
    expect(fromArrival).toBeLessThan(300);
    expect(Math.hypot(TOWN_SIGNPOST.x - TOWN_CENTER.x, TOWN_SIGNPOST.y - TOWN_CENTER.y)).toBeGreaterThan(150);
    for (const door of TOWN_DOORS) expect(Math.hypot(TOWN_SIGNPOST.x - door.x, TOWN_SIGNPOST.y - door.y)).toBeGreaterThan(150);
    expect(standable(TOWN_SIGNPOST.x, TOWN_SIGNPOST.y - TOWN_FEET_OFFSET)).toBe(true);
    // Its plank points left and up: the portal is up and to the left of it.
    expect(TOWN_TRAVEL_PORTAL.x).toBeLessThan(TOWN_SIGNPOST.x);
    expect(TOWN_TRAVEL_PORTAL.y).toBeLessThan(TOWN_SIGNPOST.y);
  });
});
