import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { TOWN_CENTER, TOWN_FEET_OFFSET } from "../../shared/town";
import { MINING_NODES, MINING_NODE_KINDS, MINING_RATE_SLACK, miningBreakSeconds, miningGain, type MiningNode } from "../../shared/mining";
import { WOOD_TREE_NODES, WOODCUTTING_LOGS, WOODCUTTING_RESPAWN_SECONDS, woodcuttingChopSeconds, type WoodTree } from "../../shared/woodcutting";
import { GATHER_CLAIM_AHEAD_MS, GATHER_CLAIM_MAX_AGE_MS, GATHER_REPORT_MAX } from "../../shared/gather-batch";
import { addOres, oreCount } from "./item-refine";
import { inventorySlotCapacity } from "../../shared/gems";
import { bagSlotsUsed } from "../../shared/equipment-copies";
import { inventoryForProgress } from "./progress-helpers";
import { IRON_BOW } from "../../shared/items";
import { minedNodeKey } from "./mining";
import { choppedTreeKey } from "./woodcutting";
import { judgeGatherBatch } from "./gather-batch";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const rock = (ore: string, kind: string, skip = 0) => MINING_NODES.filter(node => node.ore === ore && node.kind === kind)[skip]!;
const copper = rock("copper_ore", "small"), copperTwo = rock("copper_ore", "small", 1), copperLarge = rock("copper_ore", "large");
const iron = rock("iron_ore", "small"), mysterious = rock("copper_ore", "mysterious");
const pines = WOOD_TREE_NODES.filter(node => node.kind === "pine");

/** A player in the Town reporting breaks; times are seconds on the server's clock. */
function gatherer() {
  const f = crystalFixture();
  const nowS = () => Number(f.ctx.timestamp.microsSinceUnixEpoch) / 1_000_000;
  const later = (seconds: number) => { f.ctx.timestamp = new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + BigInt(Math.round(seconds * 1_000_000))); };
  const standAt = (at: { x: number; y: number }) => f.patch("player", { mapId: "town", x: at.x, y: at.y - TOWN_FEET_OFFSET });
  const atMs = (seconds: number) => BigInt(Math.round(seconds * 1_000));
  const reportMining = (breaks: [MiningNode | number, number][]) =>
    f.run(server.reportMining, { breaks: breaks.map(([node, at]) => ({ nodeId: typeof node === "number" ? node : node.id, atMs: atMs(at) })) });
  const reportChopping = (chops: [WoodTree, number][]) => f.run(server.reportChopping, { chops: chops.map(([tree, at]) => ({ treeId: tree.id, atMs: atMs(at) })) });
  const mining = () => f.db.playerMining.identity.find(f.ctx.sender);
  const ore = (oreId: string) => oreCount(f.ctx, f.ctx.sender, oreId);
  const bareAt = (node: MiningNode) => f.db.playerMinedNode.key.find(minedNodeKey(f.ctx.sender, node.id))?.brokenAt.microsSinceUnixEpoch;
  standAt(copper);
  later(300);
  return { ...f, nowS, later, standAt, reportMining, reportChopping, mining, ore, bareAt };
}

/** Every bag slot taken: these ores, and kept copies in the rest; `free` slots left open. */
function fullBag(ores: Record<string, number>, free = 0) {
  const f = gatherer();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
  for (const [oreId, count] of Object.entries(ores)) addOres(f.ctx, f.ctx.sender, oreId as never, count);
  const used = bagSlotsUsed(inventoryForProgress(progressOf(f, f.ctx.sender)), [IRON_BOW], 0, Object.keys(ores).length);
  for (let index = used; index < inventorySlotCapacity(0) - free; index++) {
    f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp });
  }
  return f;
}

describe("a mining report", () => {
  it("takes every break in one call: ore added up, Mining raised, each rock bare from its own break", () => {
    const f = gatherer(), t = f.nowS() - 15;
    f.reportMining([[copper, t], [copperTwo, t + 5], [copperLarge, t + 14]]);
    expect([f.ore("copper_ore"), f.mining()?.mining, f.mining()?.rocksBroken, f.mining()?.lastNodeId]).toEqual([5, 5, 3, copperLarge.id]);
    expect(f.db.playerMiningLevel.identity.find(f.ctx.sender)?.mining).toBe(5);
    expect([f.bareAt(copper), f.bareAt(copperTwo), f.bareAt(copperLarge)]).toEqual([t, t + 5, t + 14].map(s => BigInt(Math.round(s * 1_000)) * 1_000n));
    expect(f.mining()?.lastBreakAt.microsSinceUnixEpoch).toBe(BigInt(Math.round((t + 14) * 1_000)) * 1_000n);
  });

  it("does nothing for an empty report, and refuses a malformed one whole", () => {
    const f = gatherer();
    f.reportMining([]);
    expect(f.mining()).toBeFalsy();
    const t = f.nowS() - 60;
    const long = Array.from({ length: GATHER_REPORT_MAX + 1 }, (_, index) => [copper, t + index] as [MiningNode, number]);
    expect(() => f.reportMining(long)).toThrow("That report is too long.");
    expect(f.ore("copper_ore")).toBe(0);
  });

  it("skips a bad break without losing the rest of the batch", () => {
    const f = gatherer(), t = f.nowS() - 20;
    f.reportMining([[99_999, t], [copper, t + 1], [copper, t + 10], [copperTwo, t + 15]]);
    // The unknown rock and the second break of a bare one are skipped; the others count.
    expect([f.ore("copper_ore"), f.mining()?.rocksBroken]).toEqual([2, 2]);
  });

  it("counts a break claimed too soon after the one before at the earliest it could have been, and only that", () => {
    const f = gatherer(), t = f.nowS() - 2, gap = miningBreakSeconds(copperTwo, miningGain(copper)) * MINING_RATE_SLACK;
    f.reportMining([[copper, t], [copperTwo, t + .5], [copperLarge, t + 1]]);
    // The second fits by now, a break's time after the first; the large rock after it would be later still.
    expect([f.ore("copper_ore"), f.mining()?.rocksBroken]).toEqual([2, 2]);
    expect(f.bareAt(copperTwo)).toBe(BigInt(Math.round((t + gap) * 1_000)) * 1_000n);
    expect(f.bareAt(copperLarge)).toBeUndefined();
  });

  it("moves a batch claimed on a clock running ahead back as a whole, its gaps kept", () => {
    const f = gatherer(), now = f.nowS();
    f.reportMining([[copper, now + 50], [copperTwo, now + 60], [copperLarge, now + 70]]);
    expect(f.mining()?.rocksBroken).toBe(3);
    const ahead = BigInt(GATHER_CLAIM_AHEAD_MS) * 1_000n;
    expect([f.bareAt(copper), f.bareAt(copperTwo), f.bareAt(copperLarge)])
      .toEqual([20_000_000n, 10_000_000n, 0n].map(back => f.ctx.timestamp.microsSinceUnixEpoch + ahead - back));
    // Earlier than the last break taken, with no time since for another: too soon.
    f.later(2);
    f.reportMining([[copperTwo, f.nowS() - 100]]);
    expect(f.mining()?.rocksBroken).toBe(3);
  });

  it("loses no breaks to a device clock two minutes ahead, report after report", () => {
    const f = gatherer(), rocks = MINING_NODES.filter(node => node.ore === "copper_ore" && node.kind === "small");
    let real = f.nowS();
    for (let report = 0; report < 4; report++) {
      // Three rocks five seconds apart, sent twenty seconds after the first, every time claimed 125 seconds ahead.
      const breaks = [0, 1, 2].map(index => [rocks[report * 3 + index], real + index * 5 + 125] as [MiningNode, number]);
      f.later(20);
      f.reportMining(breaks);
      f.later(1);
      real = f.nowS();
    }
    expect(f.mining()?.rocksBroken).toBe(12);
  });

  it("loses no breaks to a device clock a day behind", () => {
    const f = gatherer(), t = f.nowS() - 86_400 - 15;
    f.reportMining([[copper, t], [copperTwo, t + 5], [copperLarge, t + 14]]);
    expect(f.mining()?.rocksBroken).toBe(3);
  });

  it("never claims more breaks than the time since the last report holds", () => {
    const f = gatherer(), t = f.nowS() - 6;
    f.reportMining([[copper, t]]);
    f.later(4);
    const seconds = miningBreakSeconds(copperTwo, 1);
    // Six seconds of breaks claimed in four real ones: the first fits, the rest do not.
    f.reportMining([[copperTwo, t + seconds], [copperLarge, t + 2 * seconds], [copperTwo, t + 3 * seconds]]);
    expect(f.mining()?.rocksBroken).toBe(2);
  });

  it("lets a rock grow back within a batch, by the claimed times", () => {
    const f = gatherer(), respawn = MINING_NODE_KINDS.small.respawnSeconds, t = f.nowS() - respawn - 5;
    f.reportMining([[copper, t], [copper, t + respawn - 1], [copper, t + respawn + 1]]);
    expect(f.mining()?.rocksBroken).toBe(2);
  });

  it("opens a deeper vein as Mining grows within the batch", () => {
    const f = gatherer(), t = f.nowS() - 20;
    f.seed("playerMining", { identity: f.ctx.sender, mining: 50 - miningGain(copper), rocksBroken: 0, pickaxeAt: f.ctx.timestamp,
      lastBreakAt: new Timestamp(0n), lastNodeId: 0, lastStarshard: false });
    f.standAt(iron);
    f.reportMining([[iron, t], [copper, t + 1], [iron, t + 15]]);
    // The first iron is shut; the copper opens it; the rock far from where the player stands is still in walking reach.
    expect([f.ore("iron_ore"), f.ore("copper_ore"), f.mining()?.rocksBroken]).toEqual([1, 1, 2]);
  });

  it("takes breaks only within a walk of where the server last heard the player", () => {
    const f = gatherer();
    f.patch("player", { mapId: "town", x: TOWN_CENTER.x, y: TOWN_CENTER.y, lastInputAt: f.ctx.timestamp });
    f.later(2);
    f.reportMining([[copper, f.nowS() - 1]]);
    expect(f.mining()).toBeFalsy();
    // Long enough ago that they could have walked from there.
    const g = gatherer();
    g.patch("player", { mapId: "town", x: TOWN_CENTER.x, y: TOWN_CENTER.y, lastInputAt: g.ctx.timestamp });
    g.later(60);
    g.reportMining([[copper, g.nowS() - 1]]);
    expect(g.mining()?.rocksBroken).toBe(1);
  });

  it("takes a break claimed a little off the server's clock just before walking on to the next rock", () => {
    // Auto Mine broke one rock, walked three seconds to another and stopped there; the client's clock ran two seconds ahead.
    const f = gatherer(), next = MINING_NODES.filter(node => node.ore === "copper_ore" && node.kind === "small")[15];
    expect(Math.hypot(next.x - copper.x, next.y - copper.y)).toBeGreaterThan(550);
    f.later(5);
    f.patch("player", { mapId: "town", x: next.x, y: next.y - TOWN_FEET_OFFSET, lastInputAt: f.ctx.timestamp });
    f.later(1);
    f.reportMining([[copper, f.nowS() - 1 - 3.35 + 2]]);
    expect(f.mining()?.rocksBroken).toBe(1);
  });

  it("is refused off the Town map and mid-duel", () => {
    const f = gatherer();
    f.patch("player", { mapId: "crystal_hollows" });
    expect(() => f.reportMining([[copper, f.nowS() - 1]])).toThrow("Walk up to the rock first.");
    const g = gatherer();
    g.seed("duel", { id: 1n, challenger: g.ctx.sender, opponent: identity("8"), status: "active" });
    expect(() => g.reportMining([[copper, g.nowS() - 1]])).toThrow("Finish your duel first.");
  });

  it("gives a Starshard from every Mysterious rock in the batch", () => {
    const f = gatherer(), t = f.nowS() - 30;
    f.standAt(mysterious);
    f.reportMining([[copper, t], [mysterious, t + 16]]);
    expect([f.ore("starshard"), f.ore("copper_ore"), f.mining()?.lastStarshard]).toEqual([1, 3, true]);
  });

  it("lets breaks of held kinds in with a full bag and drops the ones that need a new slot", () => {
    const f = fullBag({ copper_ore: 1 }), t = f.nowS() - 40;
    f.reportMining([[copper, t], [mysterious, t + 15], [copperTwo, t + 30]]);
    expect([f.ore("copper_ore"), f.ore("starshard"), f.mining()?.rocksBroken]).toEqual([3, 0, 2]);
    expect(f.bareAt(mysterious)).toBeUndefined();
    // One free slot: the first new kind takes it, a second new kind finds none.
    const g = fullBag({}, 1);
    g.seed("playerMining", { identity: g.ctx.sender, mining: 75, rocksBroken: 0, pickaxeAt: g.ctx.timestamp, lastBreakAt: new Timestamp(0n), lastNodeId: 0, lastStarshard: false });
    g.reportMining([[copper, g.nowS() - 40], [iron, g.nowS() - 20]]);
    expect([g.ore("copper_ore"), g.ore("iron_ore")]).toEqual([1, 0]);
  });

  it("clears rows of rocks that grew back, and keeps the old one-rock reducer working", () => {
    const f = gatherer();
    f.run(server.mineNode, { nodeId: copper.id });
    expect(f.mining()?.rocksBroken).toBe(1);
    f.later(MINING_NODE_KINDS.small.respawnSeconds + 5);
    f.reportMining([[copperLarge, f.nowS() - 1]]);
    expect([...f.db.playerMinedNode.identity.filter(f.ctx.sender)].map(row => row.nodeId)).toEqual([copperLarge.id]);
    expect([f.ore("copper_ore"), f.mining()?.rocksBroken]).toEqual([4, 2]);
  });
});

describe("a chopping report", () => {
  it("fells every tree in the batch at its own time, logs added up", () => {
    const f = gatherer(), t = f.nowS() - 40, seconds = woodcuttingChopSeconds(pines[0], 0);
    f.standAt(pines[0]);
    f.reportChopping([[pines[0], t], [pines[1], t + seconds], [pines[0], t + 2 * seconds]]);
    const row = f.db.playerWoodcutting.identity.find(f.ctx.sender);
    expect([f.ore("pine_log"), row?.treesChopped, row?.woodcutting, row?.lastTreeId]).toEqual([2 * WOODCUTTING_LOGS, 2, 2 * WOODCUTTING_LOGS, pines[1].id]);
    expect(f.db.playerChoppedTree.key.find(choppedTreeKey(f.ctx.sender, pines[0].id))?.choppedAt.microsSinceUnixEpoch)
      .toBe(BigInt(Math.round(t * 1_000)) * 1_000n);
    expect(f.db.playerWoodcuttingLevel.identity.find(f.ctx.sender)?.woodcutting).toBe(2 * WOODCUTTING_LOGS);
  });

  it("holds falls a tree's time apart, and a stump until it grows back", () => {
    const f = gatherer(), t = f.nowS() - 30, seconds = woodcuttingChopSeconds(pines[0], 0);
    f.standAt(pines[0]);
    f.reportChopping([[pines[0], t], [pines[1], t + seconds * .5], [pines[1], t + seconds], [pines[0], t + 2 * seconds]]);
    expect(f.db.playerWoodcutting.identity.find(f.ctx.sender)?.treesChopped).toBe(2);
    f.later(WOODCUTTING_RESPAWN_SECONDS);
    f.reportChopping([[pines[0], f.nowS() - 31], [pines[0], f.nowS() - 1]]);
    expect(f.db.playerWoodcutting.identity.find(f.ctx.sender)?.treesChopped).toBe(3);
  });

  it("drops falls of a new kind of log with no bag room", () => {
    const f = fullBag({ copper_ore: 1 });
    f.standAt(pines[0]);
    f.reportChopping([[pines[0], f.nowS() - 1]]);
    expect(f.ore("pine_log")).toBe(0);
    expect(f.db.playerWoodcutting.identity.find(f.ctx.sender)).toBeFalsy();
  });
});

describe("judging a batch", () => {
  const rules = {
    node: (id: number) => (id < 3 ? { id, x: 0, y: TOWN_FEET_OFFSET } : null), canWork: () => true, gain: () => 1, seconds: () => 4,
    slack: .75, respawnMs: () => 60_000, reach: 100, kinds: () => ["copper_ore" as const],
  };
  const state = { nowMs: 1_000_000, lastAtMs: null, skill: 0, brokenAtMs: new Map(), within: () => true, held: new Set<never>(), freeSlots: () => 9 };

  it("says why each skipped break was skipped, and reads the bag only when a new kind needs it", () => {
    const freeSlots = vi.fn(() => 0);
    const judged = judgeGatherBatch([{ id: 7, atMs: 990_000 }, { id: 1, atMs: 991_000 }], rules, { ...state, freeSlots, held: new Set(["copper_ore"] as never[]) });
    expect(judged.rejected).toEqual([{ id: 7, atMs: 990_000, reason: "unknown" }]);
    expect([judged.accepted.length, judged.skill, freeSlots.mock.calls.length]).toEqual([1, 1, 0]);
    const far = judgeGatherBatch([{ id: 1, atMs: 991_000 }], rules, { ...state, within: () => false });
    expect(far.rejected.map(entry => entry.reason)).toEqual(["reach"]);
  });

  it("never takes more breaks than the window of claimable times holds, however they are claimed", () => {
    const many = { ...rules, node: (id: number) => ({ id, x: 0, y: TOWN_FEET_OFFSET }) };
    const window = GATHER_CLAIM_MAX_AGE_MS + GATHER_CLAIM_AHEAD_MS, gap = 4 * .75 * 1_000;
    for (const [from, spacing] of [[-3_600_000, 0], [-3_600_000, 1_000], [-60_000, 60_000], [600_000, 100]]) {
      const claims = Array.from({ length: 64 }, (_, index) => ({ id: index, atMs: state.nowMs + from + index * spacing }));
      const judged = judgeGatherBatch(claims, many, state);
      expect(judged.accepted.length).toBeLessThanOrEqual(Math.floor(window / gap) + 1);
      expect(judged.accepted.every(({ atMs }) => atMs >= state.nowMs - GATHER_CLAIM_MAX_AGE_MS && atMs <= state.nowMs + GATHER_CLAIM_AHEAD_MS)).toBe(true);
    }
  });
});
