import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { TOWN_FEET_OFFSET, TOWN_SMITH_POSITION } from "../../shared/town";
import { MINING_NODES, MINING_NODE_KINDS, MINING_RATE_SLACK, miningBreakSeconds, type MiningNode } from "../../shared/mining";
import { addOres, oreCount } from "./item-refine";
import { inventorySlotCapacity } from "../../shared/gems";
import { bagSlotsUsed } from "../../shared/equipment-copies";
import { inventoryForProgress } from "./progress-helpers";
import { IRON_BOW } from "../../shared/items";
import { mergeMiningData, minedNodeKey, miningFor, nodeBareFor, removeMiningData } from "./mining";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const rock = (ore: string, kind: string, skip = 0) => MINING_NODES.filter(node => node.ore === ore && node.kind === kind)[skip]!;
const copper = rock("copper_ore", "small"), copperTwo = rock("copper_ore", "small", 1), copperLarge = rock("copper_ore", "large");
const iron = rock("iron_ore", "small"), mysterious = rock("copper_ore", "mysterious");

/** A player in the Town, given the Smith's pickaxe unless told otherwise. */
function miner(pickaxe = true) {
  const f = crystalFixture();
  const later = (seconds: number) => { f.ctx.timestamp = new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + BigInt(Math.round(seconds * 1_000_000))); };
  /** Where a player stands with their feet on this point. */
  const standAt = (at: { x: number; y: number }) => f.patch("player", { mapId: "town", x: at.x, y: at.y - TOWN_FEET_OFFSET });
  const rolls = (value: number) => { f.ctx.random = Object.assign(() => value, { integerInRange: (min: number) => min }) as any; };
  if (pickaxe) { standAt(TOWN_SMITH_POSITION); f.run(server.claimPickaxe, {}); later(60); }
  const mine = (node: MiningNode) => { standAt(node); f.run(server.mineNode, { nodeId: node.id }); };
  const row = () => f.db.playerMining.identity.find(f.ctx.sender);
  const ore = (oreId: string) => oreCount(f.ctx, f.ctx.sender, oreId);
  return { ...f, later, standAt, rolls, mine, row, ore };
}

describe("the Smith's pickaxe", () => {
  it("is handed over once, and only beside the Smith", () => {
    const f = miner(false);
    f.standAt({ x: TOWN_SMITH_POSITION.x + 400, y: TOWN_SMITH_POSITION.y });
    expect(() => f.run(server.claimPickaxe, {})).toThrow("Talk to the Smith first.");
    f.standAt(TOWN_SMITH_POSITION);
    f.run(server.claimPickaxe, {});
    expect(f.row()).toMatchObject({ mining: 0, rocksBroken: 0 });
    expect(() => f.run(server.claimPickaxe, {})).toThrow("You already have a pickaxe.");
  });
});

describe("breaking a rock", () => {
  it("needs the pickaxe, a rock that exists, and the player beside it in the Town", () => {
    const bare = miner(false);
    expect(() => bare.mine(copper)).toThrow("You need a pickaxe. The Smith in Town has one.");
    const f = miner();
    expect(() => f.run(server.mineNode, { nodeId: MINING_NODES.length })).toThrow("There is no rock there.");
    f.standAt({ x: copper.x + 300, y: copper.y });
    expect(() => f.run(server.mineNode, { nodeId: copper.id })).toThrow("Walk up to the rock first.");
    f.patch("player", { mapId: "crystal_hollows", x: copper.x, y: copper.y - TOWN_FEET_OFFSET });
    expect(() => f.run(server.mineNode, { nodeId: copper.id })).toThrow("Walk up to the rock first.");
    expect(f.ore("copper_ore")).toBe(0);
  });

  it("is not done mid-duel", () => {
    const f = miner();
    f.seed("duel", { id: 1n, challenger: f.ctx.sender, opponent: identity("8"), status: "active" });
    expect(() => f.mine(copper)).toThrow("Finish your duel first.");
  });

  it("gives the vein's ore, raises Mining, and leaves the rock bare for its breaker until it grows back", () => {
    const f = miner();
    f.mine(copper);
    expect(f.ore("copper_ore")).toBe(1);
    expect(f.row()).toMatchObject({ mining: 1, rocksBroken: 1, lastNodeId: copper.id, lastStarshard: false });
    expect(nodeBareFor(f.ctx, f.ctx.sender, copper)).toBe(true);
    f.later(30);
    expect(() => f.mine(copper)).toThrow("That rock is still growing back.");
    f.later(MINING_NODE_KINDS.small.respawnSeconds - 30);
    f.mine(copper);
    expect(f.ore("copper_ore")).toBe(2);
    f.later(10);
    f.mine(copperLarge);
    expect([f.ore("copper_ore"), miningFor(f.ctx, f.ctx.sender)]).toEqual([5, 5]);
  });

  it("is bare only for the player who broke it", () => {
    const f = miner();
    f.mine(copper);
    expect(nodeBareFor(f.ctx, identity("8"), copper)).toBe(false);
  });

  it("comes no sooner after the last break than the rock takes, with a little slack", () => {
    const f = miner();
    f.mine(copper);
    const seconds = miningBreakSeconds(copperLarge, f.row().mining);
    f.later(seconds * MINING_RATE_SLACK - .05);
    expect(() => f.mine(copperLarge)).toThrow("Still mining.");
    f.later(.1);
    f.mine(copperLarge);
    expect(f.ore("copper_ore")).toBe(4);
  });

  it("keeps a deeper vein shut until the map whose gear its ore refines", () => {
    const f = miner();
    expect(() => f.mine(iron)).toThrow("Reach Night Forest - 5 to mine Iron Ore.");
    f.patch("playerProgress", { infernalUnlocked: true });
    f.mine(iron);
    expect([f.ore("iron_ore"), f.row().mining]).toEqual([1, 2]);
  });

  it("gives a Starshard only from a Mysterious rock, on the server's roll", () => {
    const f = miner();
    f.rolls(0);
    f.mine(copper);
    expect(f.ore("starshard")).toBe(0);
    f.later(20);
    f.mine(mysterious);
    expect([f.ore("copper_ore"), f.ore("starshard"), f.row().lastStarshard]).toEqual([3, 1, true]);
    f.later(MINING_NODE_KINDS.mysterious.respawnSeconds);
    f.rolls(.99);
    f.mine(mysterious);
    expect([f.ore("starshard"), f.row().lastStarshard]).toEqual([1, false]);
  });

  it("clears the rows of rocks that grew back as the player mines on", () => {
    const f = miner();
    f.mine(copper);
    f.later(10);
    f.mine(copperTwo);
    expect([...f.db.playerMinedNode.identity.filter(f.ctx.sender)].length).toBe(2);
    f.later(MINING_NODE_KINDS.small.respawnSeconds);
    f.mine(copperLarge);
    expect([...f.db.playerMinedNode.identity.filter(f.ctx.sender)].map(row => row.nodeId)).toEqual([copperLarge.id]);
  });
});

describe("ore in the bag", () => {
  /** A bag with every slot taken: these ores, and kept copies in the rest. */
  function fullBag(ores: Record<string, number> = {}) {
    const f = miner();
    f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
    for (const [oreId, count] of Object.entries(ores)) addOres(f.ctx, f.ctx.sender, oreId as never, count);
    // What the bag holds already (the starter items are always in it), counted the server's way.
    const progress = progressOf(f, f.ctx.sender);
    const used = bagSlotsUsed(inventoryForProgress(progress), [IRON_BOW], 0, Object.keys(ores).length);
    for (let index = used; index < inventorySlotCapacity(0); index++) {
      f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp });
    }
    return f;
  }

  it("needs a free slot for a kind of ore not held yet, and none for more of one held", () => {
    const f = fullBag();
    expect(() => f.mine(copper)).toThrow("Your bag is full. Free a slot for Copper Ore.");
    expect(f.ore("copper_ore")).toBe(0);
    const held = fullBag({ copper_ore: 1 });
    held.mine(copper);
    expect(held.ore("copper_ore")).toBe(2);
  });

  it("makes room for everything a Mysterious rock could give before it is broken", () => {
    const f = fullBag({ copper_ore: 1 });
    expect(() => f.mine(mysterious)).toThrow("Your bag is full. Free a slot for Starshard.");
    f.db.playerEquipmentCopy.id.delete([...f.db.playerEquipmentCopy.identity.filter(f.ctx.sender)][0].id);
    f.rolls(0);
    f.mine(mysterious);
    expect([f.ore("copper_ore"), f.ore("starshard")]).toEqual([3, 1]);
  });
});

describe("mining across saves", () => {
  it("goes with Reset Save and a deleted account, and stays through a prestige", () => {
    const f = miner();
    f.mine(copper);
    removeMiningData(f.ctx, f.ctx.sender);
    expect(f.row()).toBeFalsy();
    expect(f.db.playerMinedNode.key.find(minedNodeKey(f.ctx.sender, copper.id))).toBeFalsy();
  });

  it("moves from a guest to the account it links to, replacing the account's", () => {
    const f = miner();
    f.mine(copper);
    const account = identity("9");
    f.seed("playerMining", { identity: account, mining: 40, rocksBroken: 9, pickaxeAt: f.ctx.timestamp, lastBreakAt: f.ctx.timestamp, lastNodeId: 2, lastStarshard: false });
    mergeMiningData(f.ctx, f.ctx.sender, account);
    expect(f.row()).toBeFalsy();
    expect(f.db.playerMining.identity.find(account)).toMatchObject({ mining: 1, rocksBroken: 1 });
    expect(nodeBareFor(f.ctx, account, copper)).toBe(true);
    expect(nodeBareFor(f.ctx, f.ctx.sender, copper)).toBe(false);
  });
});
