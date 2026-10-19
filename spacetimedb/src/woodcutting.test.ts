import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { TOWN_FEET_OFFSET, TOWN_SMITH_POSITION } from "../../shared/town";
import { WOOD_TREE_NODES, WOODCUTTING_LOGS, WOODCUTTING_RATE_SLACK, WOODCUTTING_RESPAWN_SECONDS, woodcuttingChopSeconds, type WoodTree } from "../../shared/woodcutting";
import { addOres, oreCount, oreCountsFor } from "./item-refine";
import { inventorySlotCapacity } from "../../shared/gems";
import { bagSlotsUsed } from "../../shared/equipment-copies";
import { inventoryForProgress } from "./progress-helpers";
import { IRON_BOW } from "../../shared/items";
import { choppedTreeKey, mergeWoodcuttingData, removeWoodcuttingData, treeFelledFor, woodcuttingFor } from "./woodcutting";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const tree = (kind: string, skip = 0) => WOOD_TREE_NODES.filter(node => node.kind === kind)[skip]!;
const pine = tree("pine"), pineTwo = tree("pine", 1), oak = tree("oak");

/** A player in the Town: every player holds a hatchet, with no row until their first tree. */
function woodcutter() {
  const f = crystalFixture();
  const later = (seconds: number) => { f.ctx.timestamp = new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + BigInt(Math.round(seconds * 1_000_000))); };
  const standAt = (at: { x: number; y: number }) => f.patch("player", { mapId: "town", x: at.x, y: at.y - TOWN_FEET_OFFSET });
  const chop = (node: WoodTree) => { standAt(node); f.run(server.chopTree, { treeId: node.id }); };
  const row = () => f.db.playerWoodcutting.identity.find(f.ctx.sender);
  const logs = (logId: string) => oreCount(f.ctx, f.ctx.sender, logId);
  return { ...f, later, standAt, chop, row, logs };
}

describe("the old hatchet claim", () => {
  it("still answers old clients harmlessly: it starts the row once and never takes Woodcutting away", () => {
    const f = woodcutter();
    f.standAt({ x: TOWN_SMITH_POSITION.x + 400, y: TOWN_SMITH_POSITION.y });
    f.run(server.claimHatchet, {});
    expect(f.row()).toMatchObject({ woodcutting: 0, treesChopped: 0 });
    expect(f.db.playerWoodcuttingLevel.identity.find(f.ctx.sender)).toMatchObject({ woodcutting: 0 });
    f.later(60);
    f.chop(pine);
    f.run(server.claimHatchet, {});
    expect(f.row()).toMatchObject({ woodcutting: WOODCUTTING_LOGS, treesChopped: 1 });
  });
});

describe("felling a tree", () => {
  it("needs no hatchet from the Smith, only a tree that exists and the player beside it in the Town", () => {
    const fresh = woodcutter();
    expect(fresh.row()).toBeFalsy();
    fresh.chop(pine);
    expect([fresh.logs("pine_log"), fresh.row()?.woodcutting]).toEqual([WOODCUTTING_LOGS, WOODCUTTING_LOGS]);
    const f = woodcutter();
    expect(() => f.run(server.chopTree, { treeId: WOOD_TREE_NODES.length })).toThrow("There is no tree there.");
    f.standAt({ x: pine.x + 300, y: pine.y });
    expect(() => f.run(server.chopTree, { treeId: pine.id })).toThrow("Walk up to the tree first.");
    f.patch("player", { mapId: "crystal_hollows", x: pine.x, y: pine.y - TOWN_FEET_OFFSET });
    expect(() => f.run(server.chopTree, { treeId: pine.id })).toThrow("Walk up to the tree first.");
    expect(f.logs("pine_log")).toBe(0);
  });

  it("is not done mid-duel", () => {
    const f = woodcutter();
    f.seed("duel", { id: 1n, challenger: f.ctx.sender, opponent: identity("8"), status: "active" });
    expect(() => f.chop(pine)).toThrow("Finish your duel first.");
  });

  it("gives the stand's logs, raises Woodcutting, and leaves a stump for its feller until it grows back", () => {
    const f = woodcutter();
    f.chop(pine);
    expect(f.logs("pine_log")).toBe(WOODCUTTING_LOGS);
    expect(f.row()).toMatchObject({ woodcutting: WOODCUTTING_LOGS, treesChopped: 1, lastTreeId: pine.id });
    expect(f.db.playerWoodcuttingLevel.identity.find(f.ctx.sender)).toMatchObject({ woodcutting: WOODCUTTING_LOGS });
    expect(treeFelledFor(f.ctx, f.ctx.sender, pine.id)).toBe(true);
    expect(treeFelledFor(f.ctx, identity("8"), pine.id)).toBe(false);
    f.later(30);
    expect(() => f.chop(pine)).toThrow("That tree is still growing back.");
    f.later(WOODCUTTING_RESPAWN_SECONDS - 30);
    f.chop(pine);
    expect([f.logs("pine_log"), woodcuttingFor(f.ctx, f.ctx.sender)]).toEqual([2 * WOODCUTTING_LOGS, 2 * WOODCUTTING_LOGS]);
    // Logs stack in the bag as ores do.
    expect(oreCountsFor(f.ctx, f.ctx.sender)).toEqual({ pine_log: 2 * WOODCUTTING_LOGS });
  });

  it("comes no sooner after the last fall than the tree takes, with a little slack", () => {
    const f = woodcutter();
    f.chop(pine);
    const seconds = woodcuttingChopSeconds(pineTwo, f.row().woodcutting);
    f.later(seconds * WOODCUTTING_RATE_SLACK - .05);
    expect(() => f.chop(pineTwo)).toThrow("Still chopping.");
    f.later(.1);
    f.chop(pineTwo);
    expect(f.logs("pine_log")).toBe(2 * WOODCUTTING_LOGS);
  });

  it("keeps a deeper stand shut until Woodcutting reaches its mark, whatever maps are open", () => {
    const f = woodcutter();
    f.patch("playerProgress", { infernalUnlocked: true });
    expect(() => f.chop(oak)).toThrow("Reach Woodcutting 50 to chop Oak Trees.");
    f.chop(pine);
    f.db.playerWoodcutting.identity.update({ ...f.row(), woodcutting: 50 });
    f.later(60);
    f.chop(oak);
    expect([f.logs("oak_log"), f.row().woodcutting]).toEqual([WOODCUTTING_LOGS, 50 + 2 * WOODCUTTING_LOGS]);
  });

  it("clears the rows of trees that grew back as the player chops on", () => {
    const f = woodcutter();
    f.chop(pine);
    f.later(20);
    f.chop(pineTwo);
    expect([...f.db.playerChoppedTree.identity.filter(f.ctx.sender)].length).toBe(2);
    f.later(WOODCUTTING_RESPAWN_SECONDS);
    f.chop(tree("pine", 2));
    expect([...f.db.playerChoppedTree.identity.filter(f.ctx.sender)].map(row => row.treeId)).toEqual([tree("pine", 2).id]);
  });
});

describe("logs in the bag", () => {
  it("need a free slot for a kind not held yet, and none for more of one held", () => {
    const full = (ores: Record<string, number>) => {
      const f = woodcutter();
      f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
      for (const [oreId, count] of Object.entries(ores)) addOres(f.ctx, f.ctx.sender, oreId as never, count);
      const used = bagSlotsUsed(inventoryForProgress(progressOf(f, f.ctx.sender)), [IRON_BOW], 0, Object.keys(ores).length);
      for (let index = used; index < inventorySlotCapacity(0); index++) {
        f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp });
      }
      return f;
    };
    const f = full({ copper_ore: 3 });
    expect(() => f.chop(pine)).toThrow("Your bag is full. Free a slot for Pine Log.");
    const held = full({ pine_log: 1 });
    held.chop(pine);
    expect(held.logs("pine_log")).toBe(1 + WOODCUTTING_LOGS);
  });

  it("can be destroyed from the bag as an ore stack can", () => {
    const f = woodcutter();
    f.chop(pine);
    f.run(server.destroyOre, { oreId: "pine_log", expectedCount: WOODCUTTING_LOGS });
    expect(f.logs("pine_log")).toBe(0);
  });
});

describe("woodcutting across saves", () => {
  it("goes with Reset Save and a deleted account", () => {
    const f = woodcutter();
    f.chop(pine);
    removeWoodcuttingData(f.ctx, f.ctx.sender);
    expect(f.row()).toBeFalsy();
    expect(f.db.playerWoodcuttingLevel.identity.find(f.ctx.sender)).toBeFalsy();
    expect(f.db.playerChoppedTree.key.find(choppedTreeKey(f.ctx.sender, pine.id))).toBeFalsy();
  });

  it("moves from a guest to the account it links to, replacing the account's", () => {
    const f = woodcutter();
    f.chop(pine);
    const account = identity("9");
    f.seed("playerWoodcutting", { identity: account, woodcutting: 40, treesChopped: 9, hatchetAt: f.ctx.timestamp, lastChopAt: f.ctx.timestamp, lastTreeId: 2 });
    mergeWoodcuttingData(f.ctx, f.ctx.sender, account);
    expect(f.row()).toBeFalsy();
    expect(f.db.playerWoodcutting.identity.find(account)).toMatchObject({ woodcutting: WOODCUTTING_LOGS, treesChopped: 1 });
    expect(f.db.playerWoodcuttingLevel.identity.find(account)).toMatchObject({ woodcutting: WOODCUTTING_LOGS });
    expect(treeFelledFor(f.ctx, account, pine.id)).toBe(true);
    expect(treeFelledFor(f.ctx, f.ctx.sender, pine.id)).toBe(false);
  });
});
