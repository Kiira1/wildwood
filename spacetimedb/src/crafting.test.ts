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
import { GRADE_GOLD_PRICE } from "../../shared/gear-grades";
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
  const crude = craftExperience("crude");

  it("takes the materials, puts the piece in the bag at +2 and collected, and trains the craft", () => {
    const f = crafter("smith");
    f.craft("crude_sword");
    expect(f.bag()).toContain("crude_sword");
    expect(progressOf(f).equippedRightHand).not.toBe("crude_sword");
    expect(f.ore("copper_ore")).toBe(100_000 - 10);
    expect(refineLevelFor(f.ctx, f.ctx.sender, "crude_sword")).toBe(CRAFTED_REFINE);
    expect(f.db.playerItemCollection.key.find(`${f.ctx.sender.toHexString()}:crude_sword`)).toBeTruthy();
    expect(f.experience()).toEqual({ smithing: BigInt(crude), fletching: 0n, enchanting: 0n });
  });

  it("is done at each craft's own station", () => {
    const f = crafter("smith");
    expect(() => f.craft("crude_bow")).toThrow("Go to the Archery Range first.");
    expect(() => f.craft("crude_magic_helmet")).toThrow("Go to the Mage Tower first.");
    f.craft("crude_heavy_armor");
    f.stand("archery");
    f.craft("crude_bow");
    f.craft("crude_light_helmet");
    expect(() => f.craft("crude_staff")).toThrow("Go to the Mage Tower first.");
    expect(() => f.craft("crude_medium_helmet")).toThrow("Talk to the Smith first.");
    f.stand("sorcery");
    f.craft("crude_staff");
    f.craft("crude_magic_armor");
    // The Sword Hall crafts nothing: swords are the Smith's.
    f.stand("swordplay");
    expect(() => f.craft("crude_sword")).toThrow("Talk to the Smith first.");
    f.stand("smith", "crystal_hollows");
    expect(() => f.craft("crude_sword")).toThrow("Talk to the Smith first.");
    expect(f.bag()).toEqual(expect.arrayContaining(["crude_heavy_armor", "crude_bow", "crude_light_helmet", "crude_staff", "crude_magic_armor"]));
    expect(f.experience()).toEqual({ smithing: BigInt(crude), fletching: BigInt(2 * crude), enchanting: BigInt(2 * crude) });
  });

  it("needs the grade open by Mastery, then the craft's level, and crafts any open grade, below the best held too", () => {
    const f = crafter("archery", { levels: { archery: 5 }, crafts: { fletching: 19 } });
    expect(() => f.craft("exquisite_bow")).toThrow("You need Lv 6 Archery.");
    expect(() => f.craft("rare_bow")).toThrow("You need Lv 20 Fletching.");
    f.craft("superior_bow");
    expect(f.bag()).toContain("superior_bow");
    expect(f.bag()).not.toContain("rare_bow");
    f.craft("fine_bow");
    f.craft("crude_light_helmet");
    expect(f.bag()).toEqual(expect.arrayContaining(["superior_bow", "fine_bow", "crude_light_helmet"]));
    expect(f.experience().fletching).toBe(BigInt(craftExperienceForLevel(19) + craftExperience("superior") + craftExperience("fine") + crude));
    expect(f.ore("yew_log")).toBe(100_000);
  });

  it("reforges a weapon already held: its skills only go up, the materials and experience as a craft, no new piece, no room needed", () => {
    const f = crafter("archery", { levels: { archery: 5 } });
    const rollOf = () => { const row = f.db.playerBowSkill.key.find(`${f.ctx.sender.toHexString()}:crude_bow`); return [row.arrowStorm, row.ricochet, row.piercingShot]; };
    const draws = (value: number) => Object.assign(f.ctx, { random: Object.assign(() => value, { integerInRange: (_min: number, max: number) => max }) });
    // Crafted with every appear draw missing: no skills.
    draws(.999);
    f.craft("crude_bow");
    expect(rollOf()).toEqual([0, 0, 0]);
    const bag = f.bag().length;
    // Fill the bag: a Reforge takes no slot.
    for (let index = bagSlotsUsed(f.bag(), [], 0) + 2; index < inventorySlotCapacity(0); index++) {
      f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp });
    }
    expect(() => f.craft("crude_light_armor")).toThrow("Your bag is full.");
    draws(0);
    f.craft("crude_bow");
    const best = rollOf();
    expect(best.every(chance => chance > 0)).toBe(true);
    // A poor roll never lowers them.
    draws(.999);
    f.craft("crude_bow");
    expect(rollOf()).toEqual(best);
    expect(f.bag().length).toBe(bag);
    expect(f.ore("pine_log")).toBe(100_000 - 3 * 10);
    expect(f.experience().fletching).toBe(BigInt(3 * crude));
    expect(refineLevelFor(f.ctx, f.ctx.sender, "crude_bow")).toBe(CRAFTED_REFINE);
    expect([...f.db.playerEquipmentCopy.iter()].filter((copy: any) => copy.itemId === "crude_bow")).toEqual([]);
  });

  it("takes every material or none", () => {
    const f = crafter("sorcery", { stock: 0 });
    f.transaction(() => addOres(f.ctx, f.ctx.sender, "pine_log", 50));
    expect(() => f.craft("crude_staff")).toThrow("You need 1 Arcane Crystal.");
    expect(f.ore("pine_log")).toBe(50);
    f.transaction(() => addOres(f.ctx, f.ctx.sender, "arcane_crystal", 1));
    f.craft("crude_staff");
    expect([f.ore("pine_log"), f.ore("arcane_crystal")]).toEqual([45, 0]);
  });

  it("refuses armor already held, worn or in the bag, and a stale recipe", () => {
    const f = crafter("smith");
    f.craft("crude_heavy_armor");
    expect(() => f.craft("crude_heavy_armor")).toThrow("You already have that.");
    f.patch("playerProgress", { inventoryJson: JSON.stringify(["crude_medium_armor"]), equippedChest: "crude_medium_armor" });
    expect(() => f.craft("crude_medium_armor")).toThrow("You already have that.");
    expect(() => f.craft("crude_heavy_helmet", "[]")).toThrow("That recipe changed.");
    expect(() => f.craft(IRON_BOW, "[]")).toThrow("That cannot be crafted.");
    expect(f.ore("copper_ore")).toBe(100_000 - 10);
  });

  it("needs a free bag slot, unless the craft uses up a stack", () => {
    const f = crafter("smith", { stock: 0 });
    f.transaction(() => addOres(f.ctx, f.ctx.sender, "copper_ore", 30));
    f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
    const used = bagSlotsUsed(f.bag(), [IRON_BOW], 0) + 1;
    for (let index = used; index < inventorySlotCapacity(0); index++) {
      f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp });
    }
    expect(() => f.craft("crude_sword")).toThrow("Your bag is full. Free a slot first.");
    expect(f.ore("copper_ore")).toBe(30);
    expect(() => f.craft("crude_heavy_helmet")).toThrow("Your bag is full.");
    // With 10 left, the sword takes the whole stack and frees its slot.
    f.transaction(() => f.db.playerOre.key.update({ ...f.db.playerOre.key.find(`${f.ctx.sender.toHexString()}:copper_ore`), count: 10 }));
    f.craft("crude_sword");
    expect(f.bag()).toContain("crude_sword");
    expect(f.ore("copper_ore")).toBe(0);
  });

  it("rolls a weapon's skills with three more ranks of Skill Luck than a bought one", () => {
    const f = crafter("archery", { levels: { archery: 5 } });
    // Above the bare appear chance, below it with three ranks (5% a rank).
    const draw = BOW_SKILL_APPEAR_CHANCE * 1.1;
    Object.assign(f.ctx, { random: Object.assign(() => draw, { integerInRange: (min: number, max: number) => Math.floor((min + max) / 2) }) });
    f.craft("crude_bow");
    const roll = f.db.playerBowSkill.key.find(`${f.ctx.sender.toHexString()}:crude_bow`);
    expect([roll.arrowStorm, roll.ricochet, roll.piercingShot].every(chance => chance > 0)).toBe(true);
    f.stand("smith");
    f.transaction(() => addGold(f.ctx, f.ctx.sender, 1_000));
    f.run(server.buyGradeGear, { itemId: "common_bow", expectedPrice: BigInt(GRADE_GOLD_PRICE.common) });
    const bought = f.db.playerBowSkill.key.find(`${f.ctx.sender.toHexString()}:common_bow`);
    expect([bought.arrowStorm, bought.ricochet, bought.piercingShot]).toEqual([0, 0, 0]);
  });

  it("rolls a crafted weapon's skills twice and keeps the higher, so it helps at the Skill Luck cap too", () => {
    const f = crafter("archery", { levels: { archery: 5 } });
    // The first roll's three appear draws miss; every draw after lands.
    let calls = 0;
    Object.assign(f.ctx, { random: Object.assign(() => (calls++ < 3 ? .999 : 0), { integerInRange: (_min: number, max: number) => max }) });
    f.craft("crude_bow");
    const roll = f.db.playerBowSkill.key.find(`${f.ctx.sender.toHexString()}:crude_bow`);
    expect([roll.arrowStorm, roll.ricochet, roll.piercingShot].every(chance => chance > 0)).toBe(true);
  });

  it("levels the craft and copies the level to the public table when it changes", () => {
    const f = crafter("smith", { levels: { swordplay: 5 }, crafts: { smithing: 8 } });
    const levelRow = () => f.db.playerCraftLevel.key.find(`${f.ctx.sender.toHexString()}:smithing`);
    expect(() => f.craft("fine_sword")).toThrow("You need Lv 10 Smithing.");
    // 113 to level 8, 177 to 9, 264 to 10: two Sturdy crafts (114 each) take it to 10.
    f.craft("sturdy_sword");
    expect(levelRow()?.level).toBe(9);
    f.craft("sturdy_medium_helmet");
    expect(levelRow()?.level).toBe(10);
    f.craft("fine_sword");
    expect(f.bag()).toContain("fine_sword");
  });

  it("is kept through prestige and cleared by Reset Save", () => {
    const f = crafter("smith");
    f.craft("crude_sword");
    f.seed("playerPrestige", { identity: f.ctx.sender, level: 1, perkPoints: 0, peakPower: 0, prestigedAt: f.ctx.timestamp });
    f.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
    f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 12 });
    f.run(server.prestigeAccount);
    expect(f.db.playerPrestige.identity.find(f.ctx.sender).level).toBe(2);
    expect(f.experience().smithing).toBe(BigInt(crude));
    f.run(server.resetPlayerProgress, {});
    expect([...f.db.playerCraftSkill.identity.filter(f.ctx.sender)]).toEqual([]);
    expect([...f.db.playerCraftLevel.identity.filter(f.ctx.sender)]).toEqual([]);
  });

  it("moves a guest's crafts to the account on link, replacing the account's", () => {
    const f = crafter("archery"), account = identity("5");
    f.craft("crude_bow");
    f.transaction(() => f.db.playerCraftSkill.insert({ key: craftKey(account, "smithing"), identity: account, skill: "smithing", experience: 999n }));
    f.transaction(() => mergeCraftSkills(f.ctx, f.ctx.sender, account));
    expect(craftSkillExperience(f.ctx, account)).toEqual({ smithing: 0n, fletching: BigInt(crude), enchanting: 0n });
    expect(f.db.playerCraftLevel.key.find(craftKey(account, "fletching"))?.level).toBe(craftLevelOf(crude));
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
