import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { progressOf } from "../../tests/helpers/progress";
import { TOWN_FEET_OFFSET, TOWN_SCHOOL_POSITIONS, TOWN_SMITH_POSITION } from "../../shared/town";
import { CRAFTED_REFINE, craftExperience, craftExperienceForLevel, type CraftSkill } from "../../shared/crafting";
import { craftMaterialsKey, gradeCraftMaterials } from "../../shared/grade-craft";
import { BOW_SKILL_APPEAR_CHANCE } from "../../shared/bow-skills";
import { masteryPointsForLevel, type WeaponSchool } from "../../shared/weapon-mastery";
import { bagSlotsUsed } from "../../shared/equipment-copies";
import { inventorySlotCapacity } from "../../shared/gems";
import { IRON_BOW } from "../../shared/items";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
import type { OreId } from "../../shared/refine";
import { addOres, oreCount, refineLevelFor } from "./item-refine";
import { masteryKey } from "./weapon-mastery";
import { addGold } from "./gold";
import { craftKey, craftSkillExperience, mergeCraftSkills } from "./crafting";
import { inventoryForProgress } from "./progress-helpers";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Station = "smith" | "archery" | "sorcery" | "swordplay";
const STATIONS: Record<Station, { x: number; y: number }> = {
  smith: TOWN_SMITH_POSITION,
  archery: TOWN_SCHOOL_POSITIONS.archery, sorcery: TOWN_SCHOOL_POSITIONS.sorcery, swordplay: TOWN_SCHOOL_POSITIONS.swordplay,
};

/** At a station in the Town, with plenty of every material, each school and craft at a level. */
function crafter(station: Station, options: { levels?: Partial<Record<WeaponSchool, number>>; crafts?: Partial<Record<CraftSkill, number>>; stock?: number } = {}) {
  const f = crystalFixture();
  // A craft writes the player's motion row; a test move clears it so the new spot is the one read.
  const stand = (where: Station, mapId = "town") => {
    f.transaction(() => { if (f.db.playerMotion.identity.find(f.ctx.sender)) f.db.playerMotion.identity.delete(f.ctx.sender); });
    f.patch("player", { mapId, x: STATIONS[where].x, y: STATIONS[where].y - TOWN_FEET_OFFSET });
  };
  stand(station);
  f.transaction(() => {
    for (const oreId of ["copper_ore", "iron_ore", "mithril_ore", "adamant_ore", "starshard", "pine_log", "oak_log", "yew_log", "elder_log", "arcane_crystal"] as OreId[]) {
      addOres(f.ctx, f.ctx.sender, oreId, options.stock ?? 100_000);
    }
    for (const [school, level] of Object.entries(options.levels ?? {})) {
      f.db.playerWeaponMastery.insert({ key: masteryKey(f.ctx.sender, school as WeaponSchool), identity: f.ctx.sender, school, points: BigInt(masteryPointsForLevel(level)) });
    }
    for (const [skill, level] of Object.entries(options.crafts ?? {})) {
      f.db.playerCraftSkill.insert({ key: craftKey(f.ctx.sender, skill as CraftSkill), identity: f.ctx.sender, skill, experience: BigInt(craftExperienceForLevel(level)) });
    }
  });
  const craft = (itemId: string, expected = craftMaterialsKey(gradeCraftMaterials(itemId) ?? {})) =>
    f.run(server.craftGradeGear, { itemId, expectedMaterials: expected });
  const bag = () => inventoryForProgress(progressOf(f));
  const ore = (oreId: string) => oreCount(f.ctx, f.ctx.sender, oreId);
  const experience = () => craftSkillExperience(f.ctx, f.ctx.sender);
  return { ...f, stand, craft, bag, ore, experience };
}

describe("crafting graded gear", () => {
  it("takes the materials, puts the piece in the bag at +2 and collected, and trains the craft", () => {
    const f = crafter("smith");
    f.craft("common_sword");
    expect(f.bag()).toContain("common_sword");
    expect(progressOf(f).equippedRightHand).not.toBe("common_sword");
    expect(f.ore("copper_ore")).toBe(100_000 - 20);
    expect(refineLevelFor(f.ctx, f.ctx.sender, "common_sword")).toBe(CRAFTED_REFINE);
    expect(f.db.playerItemCollection.key.find(`${f.ctx.sender.toHexString()}:common_sword`)).toBeTruthy();
    expect(f.experience()).toEqual({ smithing: BigInt(craftExperience("common")), fletching: 0n, enchanting: 0n });
  });

  it("is done at each craft's own station", () => {
    const f = crafter("smith");
    expect(() => f.craft("common_bow")).toThrow("Go to the Archery Range first.");
    expect(() => f.craft("common_magic_helmet")).toThrow("Go to the Mage Tower first.");
    f.craft("common_heavy_armor");
    f.stand("archery");
    f.craft("common_bow");
    f.craft("common_light_helmet");
    expect(() => f.craft("common_staff")).toThrow("Go to the Mage Tower first.");
    expect(() => f.craft("common_medium_helmet")).toThrow("Talk to the Smith first.");
    f.stand("sorcery");
    f.craft("common_staff");
    f.craft("common_magic_armor");
    // The Sword Hall crafts nothing: swords are the Smith's.
    f.stand("swordplay");
    expect(() => f.craft("uncommon_sword")).toThrow("Talk to the Smith first.");
    f.stand("smith", "crystal_hollows");
    expect(() => f.craft("uncommon_sword")).toThrow("Talk to the Smith first.");
    expect(f.bag()).toEqual(expect.arrayContaining(["common_heavy_armor", "common_bow", "common_light_helmet", "common_staff", "common_magic_armor"]));
    expect(f.experience()).toEqual({ smithing: 25n, fletching: 50n, enchanting: 50n });
  });

  it("needs the grade open by Mastery, then the craft's level", () => {
    const f = crafter("archery", { levels: { archery: 10 }, crafts: { fletching: 19 } });
    expect(() => f.craft("epic_bow")).toThrow("You need Lv 20 Archery.");
    expect(() => f.craft("rare_bow")).toThrow("You need Lv 20 Fletching.");
    f.craft("uncommon_bow");
    expect(f.bag()).toContain("uncommon_bow");
    expect(f.bag()).not.toContain("rare_bow");
    expect(f.ore("yew_log")).toBe(100_000);
  });

  it("takes every material or none", () => {
    const f = crafter("sorcery", { stock: 0 });
    f.transaction(() => addOres(f.ctx, f.ctx.sender, "pine_log", 50));
    expect(() => f.craft("common_staff")).toThrow("You need 2 Arcane Crystal.");
    expect(f.ore("pine_log")).toBe(50);
    f.transaction(() => addOres(f.ctx, f.ctx.sender, "arcane_crystal", 2));
    f.craft("common_staff");
    expect([f.ore("pine_log"), f.ore("arcane_crystal")]).toEqual([40, 0]);
  });

  it("refuses a piece already held, worn or in the bag, and a stale recipe", () => {
    const f = crafter("smith");
    f.craft("common_sword");
    expect(() => f.craft("common_sword")).toThrow("You already have that.");
    f.patch("playerProgress", { inventoryJson: JSON.stringify(["common_medium_armor"]), equippedChest: "common_medium_armor" });
    expect(() => f.craft("common_medium_armor")).toThrow("You already have that.");
    expect(() => f.craft("common_heavy_helmet", "[]")).toThrow("That recipe changed.");
    expect(() => f.craft(IRON_BOW, "[]")).toThrow("That cannot be crafted.");
    expect(f.ore("copper_ore")).toBe(100_000 - 20);
  });

  it("needs a free bag slot, unless the craft uses up a stack", () => {
    const f = crafter("smith", { stock: 0 });
    f.transaction(() => addOres(f.ctx, f.ctx.sender, "copper_ore", 30));
    f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
    const used = bagSlotsUsed(f.bag(), [IRON_BOW], 0) + 1;
    for (let index = used; index < inventorySlotCapacity(0); index++) {
      f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp });
    }
    expect(() => f.craft("common_sword")).toThrow("Your bag is full. Free a slot first.");
    expect(f.ore("copper_ore")).toBe(30);
    expect(() => f.craft("common_heavy_helmet")).toThrow("Your bag is full.");
    // With 20 left, the sword takes the whole stack and frees its slot.
    f.transaction(() => f.db.playerOre.key.update({ ...f.db.playerOre.key.find(`${f.ctx.sender.toHexString()}:copper_ore`), count: 20 }));
    f.craft("common_sword");
    expect(f.bag()).toContain("common_sword");
    expect(f.ore("copper_ore")).toBe(0);
  });

  it("rolls a weapon's skills with three more ranks of Skill Luck than a bought one", () => {
    const f = crafter("archery", { levels: { archery: 5 } });
    // Above the bare appear chance, below it with three ranks (5% a rank).
    const draw = BOW_SKILL_APPEAR_CHANCE * 1.1;
    Object.assign(f.ctx, { random: Object.assign(() => draw, { integerInRange: (min: number, max: number) => Math.floor((min + max) / 2) }) });
    f.craft("common_bow");
    const roll = f.db.playerBowSkill.key.find(`${f.ctx.sender.toHexString()}:common_bow`);
    expect([roll.arrowStorm, roll.ricochet, roll.piercingShot].every(chance => chance > 0)).toBe(true);
    f.stand("smith");
    f.transaction(() => addGold(f.ctx, f.ctx.sender, 1_000));
    f.run(server.buyGradeGear, { itemId: "uncommon_bow", expectedPrice: 1_000n });
    const bought = f.db.playerBowSkill.key.find(`${f.ctx.sender.toHexString()}:uncommon_bow`);
    expect([bought.arrowStorm, bought.ricochet, bought.piercingShot]).toEqual([0, 0, 0]);
  });

  it("rolls a crafted weapon's skills twice and keeps the higher, so it helps at the Skill Luck cap too", () => {
    const f = crafter("archery", { levels: { archery: 5 } });
    // The first roll's three appear draws miss; every draw after lands.
    let calls = 0;
    Object.assign(f.ctx, { random: Object.assign(() => (calls++ < 3 ? .999 : 0), { integerInRange: (_min: number, max: number) => max }) });
    f.craft("common_bow");
    const roll = f.db.playerBowSkill.key.find(`${f.ctx.sender.toHexString()}:common_bow`);
    expect([roll.arrowStorm, roll.ricochet, roll.piercingShot].every(chance => chance > 0)).toBe(true);
  });

  it("levels the craft and copies the level to the public table when it changes", () => {
    const f = crafter("smith", { levels: { swordplay: 5 }, crafts: { smithing: 9 } });
    const levelRow = () => f.db.playerCraftLevel.key.find(`${f.ctx.sender.toHexString()}:smithing`);
    f.craft("common_sword");
    expect(levelRow()?.level).toBe(9);
    // 177 to level 9, 264 to 10: the fourth craft levels it.
    for (const itemId of ["common_medium_helmet", "common_medium_armor", "common_heavy_helmet"]) f.craft(itemId);
    expect(levelRow()?.level).toBe(10);
    f.craft("uncommon_sword");
    expect(f.bag()).toContain("uncommon_sword");
  });

  it("is kept through prestige and cleared by Reset Save", () => {
    const f = crafter("smith");
    f.craft("common_sword");
    f.seed("playerPrestige", { identity: f.ctx.sender, level: 1, perkPoints: 0, peakPower: 0, prestigedAt: f.ctx.timestamp });
    f.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
    f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 12 });
    f.run(server.prestigeAccount);
    expect(f.db.playerPrestige.identity.find(f.ctx.sender).level).toBe(2);
    expect(f.experience().smithing).toBe(25n);
    f.run(server.resetPlayerProgress, {});
    expect([...f.db.playerCraftSkill.identity.filter(f.ctx.sender)]).toEqual([]);
    expect([...f.db.playerCraftLevel.identity.filter(f.ctx.sender)]).toEqual([]);
  });

  it("moves a guest's crafts to the account on link, replacing the account's", () => {
    const f = crafter("archery"), account = identity("5");
    f.craft("common_bow");
    f.transaction(() => f.db.playerCraftSkill.insert({ key: craftKey(account, "smithing"), identity: account, skill: "smithing", experience: 999n }));
    f.transaction(() => mergeCraftSkills(f.ctx, f.ctx.sender, account));
    expect(craftSkillExperience(f.ctx, account)).toEqual({ smithing: 0n, fletching: 25n, enchanting: 0n });
    expect(f.db.playerCraftLevel.key.find(craftKey(account, "fletching"))?.level).toBe(craftLevelOf(25));
    expect(f.db.playerCraftLevel.key.find(craftKey(account, "smithing"))).toBeFalsy();
    expect([...f.db.playerCraftSkill.identity.filter(f.ctx.sender)]).toEqual([]);
    expect([...f.db.playerCraftLevel.identity.filter(f.ctx.sender)]).toEqual([]);
  });
});

const craftLevelOf = (experience: number) => {
  let level = 1;
  while (craftExperienceForLevel(level + 1) <= experience) level++;
  return level;
};
