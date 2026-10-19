import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { TOWN_FEET_OFFSET, TOWN_SMITH_POSITION } from "../../shared/town";
import { MINING_NODES, MINING_RATE_SLACK, miningBreakSeconds, miningRockOre } from "../../shared/mining";
import { WOOD_TREE_NODES, WOODCUTTING_LOGS, WOODCUTTING_RATE_SLACK, woodcuttingChopSeconds } from "../../shared/woodcutting";
import { craftExperience, craftExperienceForLevel, type CraftSkill } from "../../shared/crafting";
import { craftMaterialsKey, gradeCraftMaterials } from "../../shared/grade-craft";
import { toolUpgradeCost, type ToolId } from "../../shared/tools";
import type { OreId } from "../../shared/refine";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
import { addOres, oreCount } from "./item-refine";
import { addGold, goldFor } from "./gold";
import { craftKey, craftSkillExperience } from "./crafting";
import { mergeTools, toolKey, toolLevelFor } from "./tools";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const ORES: OreId[] = ["copper_ore", "iron_ore", "mithril_ore", "adamant_ore", "starshard", "pine_log", "oak_log", "yew_log", "elder_log", "arcane_crystal"];
const copper = MINING_NODES.find(node => node.ore === "copper_ore" && node.kind === "small")!;
const copperTwo = MINING_NODES.filter(node => node.ore === "copper_ore" && node.kind === "small")[1]!;
const pine = WOOD_TREE_NODES.find(tree => tree.kind === "pine")!;
const pineTwo = WOOD_TREE_NODES.filter(tree => tree.kind === "pine")[1]!;

/** At the Smith with Mining and Woodcutting rows started (by the old claims), `stock` of every material and `gold`, and skills as given. */
function smithy(options: { stock?: number; gold?: number; mining?: number; woodcutting?: number; crafts?: Partial<Record<CraftSkill, number>>; claim?: boolean } = {}) {
  const f = crystalFixture();
  const later = (seconds: number) => { f.ctx.timestamp = new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + BigInt(Math.round(seconds * 1_000_000))); };
  // A reducer writes the player's motion row; a test move clears it so the new spot is the one read.
  const standAt = (at: { x: number; y: number }) => {
    f.transaction(() => { if (f.db.playerMotion.identity.find(f.ctx.sender)) f.db.playerMotion.identity.delete(f.ctx.sender); });
    f.patch("player", { mapId: "town", x: at.x, y: at.y - TOWN_FEET_OFFSET });
  };
  const rolls = (value: number) => { f.ctx.random = Object.assign(() => value, { integerInRange: (min: number) => min }) as any; };
  standAt(TOWN_SMITH_POSITION);
  if (options.claim !== false) { f.run(server.claimPickaxe, {}); f.run(server.claimHatchet, {}); }
  f.transaction(() => {
    for (const oreId of ORES) if (options.stock ?? 100_000) addOres(f.ctx, f.ctx.sender, oreId, options.stock ?? 100_000);
    addGold(f.ctx, f.ctx.sender, options.gold ?? 10_000);
    if (options.mining && f.db.playerMining.identity.find(f.ctx.sender)) f.db.playerMining.identity.update({ ...f.db.playerMining.identity.find(f.ctx.sender), mining: options.mining });
    if (options.woodcutting && f.db.playerWoodcutting.identity.find(f.ctx.sender)) {
      f.db.playerWoodcutting.identity.update({ ...f.db.playerWoodcutting.identity.find(f.ctx.sender), woodcutting: options.woodcutting });
    }
    for (const [skill, level] of Object.entries(options.crafts ?? {})) {
      f.db.playerCraftSkill.insert({ key: craftKey(f.ctx.sender, skill as CraftSkill), identity: f.ctx.sender, skill, experience: BigInt(craftExperienceForLevel(level)) });
    }
  });
  later(60);
  const upgrade = (tool: string, expectedLevel = toolLevelFor(f.ctx, f.ctx.sender, tool as ToolId)) => f.run(server.upgradeTool, { tool, expectedLevel });
  const level = (tool: ToolId, who = f.ctx.sender) => toolLevelFor(f.ctx, who, tool);
  const setLevel = (tool: ToolId, value: number) => f.seed("playerTool", { key: toolKey(f.ctx.sender, tool), identity: f.ctx.sender, tool, level: value });
  const ore = (oreId: string) => oreCount(f.ctx, f.ctx.sender, oreId);
  return { ...f, later, standAt, rolls, upgrade, level, setLevel, ore };
}

describe("upgrading a tool", () => {
  it("takes the level's gold and materials at the Smith, one level at a time", () => {
    const f = smithy({ mining: 10 });
    expect(f.level("pickaxe")).toBe(0);
    f.upgrade("pickaxe");
    expect(f.level("pickaxe")).toBe(1);
    const cost = toolUpgradeCost("pickaxe", 1)!;
    expect(f.ore("copper_ore")).toBe(100_000 - cost.materials.copper_ore);
    expect(goldFor(f.ctx, f.ctx.sender)).toBe(BigInt(10_000 - cost.gold));
    expect(f.db.playerTool.key.find(toolKey(f.ctx.sender, "pickaxe"))).toMatchObject({ tool: "pickaxe", level: 1 });
  });

  it("is done beside the Smith, out of a duel, for a real tool, at the level the player saw", () => {
    const f = smithy({ mining: 10 });
    f.standAt({ x: TOWN_SMITH_POSITION.x + 400, y: TOWN_SMITH_POSITION.y });
    expect(() => f.upgrade("pickaxe")).toThrow("Talk to the Smith first.");
    f.standAt(TOWN_SMITH_POSITION);
    expect(() => f.upgrade("shovel", 0)).toThrow("There is no such tool.");
    expect(() => f.upgrade("pickaxe", 1)).toThrow("Your tool changed. Take another look.");
    f.seed("duel", { id: 1n, challenger: f.ctx.sender, opponent: identity("8"), status: "active" });
    expect(() => f.upgrade("pickaxe")).toThrow("Finish your duel first.");
    expect(f.level("pickaxe")).toBe(0);
  });

  it("needs no claim for the Pickaxe or Hatchet: their skill alone gates them, as the craft tools' do", () => {
    const f = smithy({ claim: false, crafts: { smithing: 3 } });
    expect(() => f.upgrade("pickaxe")).toThrow("You need Lv 10 Mining.");
    expect(() => f.upgrade("hatchet")).toThrow("You need Lv 10 Woodcutting.");
    // Mining from rocks alone, never claimed.
    f.transaction(() => f.db.playerMining.insert({ identity: f.ctx.sender, mining: 10, rocksBroken: 10, pickaxeAt: f.ctx.timestamp, lastBreakAt: f.ctx.timestamp,
      lastNodeId: 0, lastStarshard: false }));
    f.upgrade("pickaxe");
    f.upgrade("hammer");
    expect([f.level("pickaxe"), f.level("hammer")]).toEqual([1, 1]);
  });

  it("waits for the skill, then the materials, then the gold, and charges nothing when refused", () => {
    expect(() => smithy({ mining: 9 }).upgrade("pickaxe")).toThrow("You need Lv 10 Mining.");
    expect(() => smithy({ woodcutting: 9 }).upgrade("hatchet")).toThrow("You need Lv 10 Woodcutting.");
    expect(() => smithy({ crafts: { enchanting: 2 } }).upgrade("focus")).toThrow("You need Lv 3 Enchanting.");
    const poor = smithy({ mining: 10, stock: 0, gold: 5 });
    expect(() => poor.upgrade("pickaxe")).toThrow("You need 15 Copper Ore.");
    poor.transaction(() => addOres(poor.ctx, poor.ctx.sender, "copper_ore", 15));
    expect(() => poor.upgrade("pickaxe")).toThrow("You need 10 Gold.");
    expect([poor.ore("copper_ore"), goldFor(poor.ctx, poor.ctx.sender)]).toEqual([15, 5n]);
    poor.transaction(() => addGold(poor.ctx, poor.ctx.sender, 5));
    poor.upgrade("pickaxe");
    expect([poor.ore("copper_ore"), goldFor(poor.ctx, poor.ctx.sender), poor.level("pickaxe")]).toEqual([0, 0n, 1]);
  });

  it("stops at level 10", () => {
    const f = smithy({ crafts: { fletching: 99 } });
    f.setLevel("knife", 9);
    f.upgrade("knife");
    expect(f.level("knife")).toBe(10);
    expect(() => f.upgrade("knife")).toThrow("That tool is fully upgraded.");
  });
});

describe("a gathering tool", () => {
  it("breaks rocks faster, and the server's rate check allows for it", () => {
    const f = smithy();
    f.setLevel("pickaxe", 10);
    f.standAt(copper);
    f.run(server.mineNode, { nodeId: copper.id });
    const mining = f.db.playerMining.identity.find(f.ctx.sender).mining;
    const seconds = miningBreakSeconds(copperTwo, mining, 0, 10);
    expect(seconds).toBeCloseTo(miningBreakSeconds(copperTwo, mining) / 2);
    f.later(seconds * MINING_RATE_SLACK - .05);
    f.standAt(copperTwo);
    expect(() => f.run(server.mineNode, { nodeId: copperTwo.id })).toThrow("Still mining.");
    f.later(.1);
    f.run(server.mineNode, { nodeId: copperTwo.id });
  });

  it("gives one more ore or log when its chance comes up, and none at Worn", () => {
    const worn = smithy({ stock: 0 });
    worn.rolls(0);
    worn.standAt(copper);
    worn.run(server.mineNode, { nodeId: copper.id });
    expect(worn.ore("copper_ore")).toBe(miningRockOre(copper));
    const f = smithy({ stock: 0 });
    f.setLevel("pickaxe", 4);
    f.setLevel("hatchet", 4);
    f.rolls(.09);
    f.standAt(copper);
    f.run(server.mineNode, { nodeId: copper.id });
    expect(f.ore("copper_ore")).toBe(miningRockOre(copper) + 1);
    f.standAt(pine);
    f.run(server.chopTree, { treeId: pine.id });
    expect(f.ore("pine_log")).toBe(WOODCUTTING_LOGS + 1);
    f.rolls(.1);
    f.later(woodcuttingChopSeconds(pineTwo, f.db.playerWoodcutting.identity.find(f.ctx.sender).woodcutting, 4));
    f.standAt(pineTwo);
    f.run(server.chopTree, { treeId: pineTwo.id });
    expect(f.ore("pine_log")).toBe(2 * WOODCUTTING_LOGS + 1);
  });

  it("fells trees faster, and the server's rate check allows for it", () => {
    const f = smithy();
    f.setLevel("hatchet", 5);
    f.standAt(pine);
    f.run(server.chopTree, { treeId: pine.id });
    const seconds = woodcuttingChopSeconds(pineTwo, f.db.playerWoodcutting.identity.find(f.ctx.sender).woodcutting, 5);
    f.later(seconds * WOODCUTTING_RATE_SLACK - .05);
    f.standAt(pineTwo);
    expect(() => f.run(server.chopTree, { treeId: pineTwo.id })).toThrow("Still chopping.");
    f.later(.1);
    f.run(server.chopTree, { treeId: pineTwo.id });
  });
});

describe("a craft tool", () => {
  const craft = (f: ReturnType<typeof smithy>, itemId: string) =>
    f.run(server.craftGradeGear, { itemId, expectedMaterials: craftMaterialsKey(gradeCraftMaterials(itemId)!) });

  it("saves its share of each material and adds craft experience", () => {
    const f = smithy();
    f.setLevel("hammer", 10);
    // Crude's 10 copper: 2.5 saved, so 2 and an even chance of a third.
    f.rolls(.6);
    craft(f, "crude_sword");
    expect(f.ore("copper_ore")).toBe(100_000 - 8);
    expect(craftSkillExperience(f.ctx, f.ctx.sender).smithing).toBe(BigInt(Math.floor(craftExperience("crude") * 1.3)));
    f.rolls(.4);
    craft(f, "crude_heavy_armor");
    expect(f.ore("copper_ore")).toBe(100_000 - 8 - 7);
  });

  it("saves nothing at Worn", () => {
    const f = smithy();
    craft(f, "crude_sword");
    expect(f.ore("copper_ore")).toBe(100_000 - gradeCraftMaterials("crude_sword")!.copper_ore);
    expect(craftSkillExperience(f.ctx, f.ctx.sender).smithing).toBe(BigInt(craftExperience("crude")));
  });
});

describe("tools across saves", () => {
  it("are kept through prestige and go back to Worn on Reset Save", () => {
    const f = smithy({ mining: 10 });
    f.upgrade("pickaxe");
    f.setLevel("focus", 3);
    f.seed("playerPrestige", { identity: f.ctx.sender, level: 1, perkPoints: 0, peakPower: 0, prestigedAt: f.ctx.timestamp });
    f.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
    f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 12 });
    f.run(server.prestigeAccount);
    expect([f.level("pickaxe"), f.level("focus")]).toEqual([1, 3]);
    f.run(server.resetPlayerProgress, {});
    expect([...f.db.playerTool.identity.filter(f.ctx.sender)]).toEqual([]);
  });

  it("move from a guest to the account it links to, replacing the account's", () => {
    const f = smithy();
    const account = identity("9");
    f.setLevel("hammer", 2);
    f.seed("playerTool", { key: toolKey(account, "knife"), identity: account, tool: "knife", level: 7 });
    f.transaction(() => mergeTools(f.ctx, f.ctx.sender, account));
    expect([f.level("hammer", account), f.level("knife", account), f.level("hammer")]).toEqual([2, 0, 0]);
    expect([...f.db.playerTool.identity.filter(f.ctx.sender)]).toEqual([]);
  });
});
