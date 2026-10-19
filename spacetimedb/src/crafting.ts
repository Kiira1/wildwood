import { SenderError, table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import {
  CRAFTED_REFINE, CRAFTED_SKILL_LUCK_RANKS, CRAFT_SKILLS, MATERIAL_NAMES, craftExperience, craftLevel, type CraftSkill,
} from "../../shared/crafting";
import {
  craftMaterialsKey, craftMaterialsShort, gradeCraftAction, gradeCraftLevel, gradeCraftMaterials, gradeCraftNeed, gradeCraftSkill, isCraftable,
} from "../../shared/grade-craft";
import { gradeOf } from "../../shared/grade-equipment";
import { gradeShopNeed, gradeShopOpen, masteryLevels } from "../../shared/grade-shop";
import { SCHOOL_DETAILS, type WeaponSchool } from "../../shared/weapon-mastery";
import { TOWN_FEET_OFFSET, TOWN_SCHOOL_POSITIONS, TOWN_SCHOOL_SERVER_REACH, isTownMap } from "../../shared/town";
import type { OreId } from "../../shared/refine";
import { isSkillWeapon } from "../../shared/weapon-skills";
import { withinStationReach } from "./door-reach";
import { oreCount, setRefineLevel, standsAtTheSmith, takeOres } from "./item-refine";
import { readPlayerProgress } from "./wide-stats";
import { collectItem, freeBagSlots, receiveDuplicateEquipment } from "./equipment-copies";
import { activeItemUpgradeEntriesFor } from "./upgrade-bench-slots";
import { weaponMasteryPoints } from "./weapon-mastery";
import { ensureWeaponSkillRoll } from "./weapon-skills";
import { luckInPlay } from "./luck-research";

/** Each craft's experience (shared/crafting.ts), one row per player and craft. Private; read through my_craft_skills. */
export const playerCraftSkill = table({ name: "player_craft_skill", public: false }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  skill: t.string(),
  experience: t.u64(),
});

/** Each craft's level, public, for profiles; written only when a level changes, as player_mastery_level is. */
export const playerCraftLevel = table({ name: "player_craft_level", public: true }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  skill: t.string(),
  level: t.u8(),
});

type Ctx = any;
export const craftKey = (identity: Identity, skill: CraftSkill) => `${identity.toHexString()}:${skill}`;
const isCraftSkill = (value: unknown): value is CraftSkill => (CRAFT_SKILLS as readonly unknown[]).includes(value);
const rowsOf = (ctx: Ctx, identity: Identity): any[] => [...ctx.db.playerCraftSkill.identity.filter(identity)];

/** Each craft's experience, 0 for a craft never practised. */
export function craftSkillExperience(ctx: Ctx, identity: Identity): Record<CraftSkill, bigint> {
  const experience = { smithing: 0n, fletching: 0n, enchanting: 0n } as Record<CraftSkill, bigint>;
  for (const row of rowsOf(ctx, identity)) {
    const skill: unknown = row.skill;
    if (isCraftSkill(skill)) experience[skill] = row.experience;
  }
  return experience;
}

function writeCraftLevel(ctx: Ctx, identity: Identity, skill: CraftSkill, experience: bigint) {
  const key = craftKey(identity, skill), level = craftLevel(experience), row = ctx.db.playerCraftLevel.key.find(key);
  if (!row) ctx.db.playerCraftLevel.insert({ key, identity, skill, level });
  else if (row.level !== level) ctx.db.playerCraftLevel.key.update({ ...row, level });
}

export function addCraftExperience(ctx: Ctx, identity: Identity, skill: CraftSkill, amount: number) {
  if (!(amount > 0)) return;
  const key = craftKey(identity, skill), row = ctx.db.playerCraftSkill.key.find(key);
  const next = (row?.experience ?? 0n) + BigInt(Math.floor(amount));
  if (row) ctx.db.playerCraftSkill.key.update({ ...row, experience: next });
  else ctx.db.playerCraftSkill.insert({ key, identity, skill, experience: next });
  writeCraftLevel(ctx, identity, skill, next);
}

/** Each craft's station: the Smith for Smithing, a school's spot under its sign for the others. */
const CRAFT_SCHOOL: Readonly<Partial<Record<CraftSkill, WeaponSchool>>> = { fletching: "archery", enchanting: "sorcery" };

export function standsAtCraftStation(ctx: Ctx, player: Parameters<typeof withinStationReach>[1], skill: CraftSkill) {
  const school = CRAFT_SCHOOL[skill];
  if (!school) return standsAtTheSmith(ctx, player);
  const at = TOWN_SCHOOL_POSITIONS[school];
  return isTownMap(player.mapId) && withinStationReach(ctx, player, { x: at.x, y: at.y - TOWN_FEET_OFFSET }, TOWN_SCHOOL_SERVER_REACH);
}

export type CraftingDeps = {
  requireControllingPlayer: (ctx: Ctx) => any;
  activeDuelFor: (ctx: Ctx, identity: Identity) => unknown;
  inventoryForProgress: (progress: any) => string[];
  restoreItemToProgress: (progress: any, itemId: string) => any;
  writeProgressAndPresentation: (ctx: Ctx, progress: any) => void;
};

/**
 * One graded piece crafted at its station, into a free bag slot as a bought one arrives (grade-shop.ts), but at
 * +2 and with better luck on a weapon's skills. Any grade Mastery and the craft's level open can be crafted, below
 * the best held too; a weapon already held is reforged instead (its skills rolled again, keeping the higher), which
 * needs no bag room. `expectedMaterials` is the recipe the player saw.
 */
export function craftGradeGearFor(ctx: Ctx, args: { itemId: string; expectedMaterials: string }, deps: CraftingDeps) {
  const player = deps.requireControllingPlayer(ctx);
  const { itemId } = args;
  if (!isCraftable(itemId)) throw new SenderError("That cannot be crafted.");
  const skill = gradeCraftSkill(itemId)!, materials = gradeCraftMaterials(itemId)!;
  if (!standsAtCraftStation(ctx, player, skill)) {
    const school = CRAFT_SCHOOL[skill];
    throw new SenderError(school ? `Go to the ${SCHOOL_DETAILS[school].building} first.` : "Talk to the Smith first.");
  }
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  if (craftMaterialsKey(materials) !== args.expectedMaterials) throw new SenderError("That recipe changed. Take another look.");
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress) throw new SenderError("Player unavailable.");
  const inventory = deps.inventoryForProgress(progress);
  // A piece on the Upgrade Bench is still the player's.
  const owned = new Set([...inventory, ...activeItemUpgradeEntriesFor(ctx, ctx.sender).map(({ active }) => active.itemId)]);
  const action = gradeCraftAction(itemId, owned);
  if (action === "owned") throw new SenderError("You already have that.");
  if (!gradeShopOpen(itemId, masteryLevels(weaponMasteryPoints(ctx, ctx.sender)))) throw new SenderError(`You need ${gradeShopNeed(itemId)}.`);
  if (craftLevel(craftSkillExperience(ctx, ctx.sender)[skill]) < gradeCraftLevel(itemId)) throw new SenderError(`You need ${gradeCraftNeed(itemId)}.`);
  const held = Object.fromEntries(Object.keys(materials).map(id => [id, oreCount(ctx, ctx.sender, id)]));
  const short = craftMaterialsShort(materials, held);
  if (short.length) throw new SenderError(`You need ${short.map(id => `${materials[id].toLocaleString("en-US")} ${MATERIAL_NAMES[id] ?? id}`).join(" and ")}.`);
  // A stack used up frees its slot for the piece; a Reforge needs no room.
  const emptied = Object.entries(materials).filter(([id, count]) => held[id] === count).length;
  if (action === "craft" && freeBagSlots(ctx, ctx.sender, progress, inventory) + emptied <= 0) throw new SenderError("Your bag is full. Free a slot first.");
  if (!takeOres(ctx, ctx.sender, materials as Partial<Record<OreId, number>>)) throw new SenderError("Your materials changed. Take another look.");
  const skillLuck = isSkillWeapon(itemId) ? luckInPlay(ctx, ctx.sender).skillLuck + CRAFTED_SKILL_LUCK_RANKS : 0;
  addCraftExperience(ctx, ctx.sender, skill, craftExperience(gradeOf(itemId)!));
  if (action === "reforge") {
    // Two fresh rolls merged into the held weapon, each skill keeping the higher; its refine stays.
    receiveDuplicateEquipment(ctx, ctx.sender, itemId, 2, skillLuck);
    return;
  }
  collectItem(ctx, ctx.sender, itemId);
  ensureWeaponSkillRoll(ctx, ctx.sender, itemId, skillLuck);
  // A second roll merged in, each skill keeping the higher, so crafting helps even at the Skill Luck cap.
  if (skillLuck) receiveDuplicateEquipment(ctx, ctx.sender, itemId, 1, skillLuck);
  setRefineLevel(ctx, ctx.sender, itemId, 0n, CRAFTED_REFINE);
  deps.writeProgressAndPresentation(ctx, deps.restoreItemToProgress(progress, itemId));
}

/** Reset Save clears every craft. Prestige keeps them. */
export function removeCraftSkills(ctx: Ctx, identity: Identity) {
  for (const row of rowsOf(ctx, identity)) ctx.db.playerCraftSkill.key.delete(row.key);
  for (const row of [...ctx.db.playerCraftLevel.identity.filter(identity)]) ctx.db.playerCraftLevel.key.delete(row.key);
}

/** A guest's save replaces the account's on link, as Mining does, its crafts with it. */
export function mergeCraftSkills(ctx: Ctx, guest: Identity, account: Identity) {
  removeCraftSkills(ctx, account);
  for (const row of rowsOf(ctx, guest)) {
    ctx.db.playerCraftSkill.key.delete(row.key);
    const skill: unknown = row.skill;
    if (!isCraftSkill(skill)) continue;
    ctx.db.playerCraftSkill.insert({ ...row, key: craftKey(account, skill), identity: account });
    writeCraftLevel(ctx, account, skill, row.experience);
  }
  for (const row of [...ctx.db.playerCraftLevel.identity.filter(guest)]) ctx.db.playerCraftLevel.key.delete(row.key);
}

/** The craft_grade_gear reducer, and the player's own craft experience. */
export function registerCrafting(spacetimedb: typeof spacetimedbType, deps: CraftingDeps) {
  const craftGradeGear = spacetimedb.reducer({ itemId: t.string(), expectedMaterials: t.string() },
    (ctx: any, args: { itemId: string; expectedMaterials: string }) => craftGradeGearFor(ctx, args, deps));
  const myCraftSkills = spacetimedb.view({ name: "my_craft_skills", public: true }, t.array(playerCraftSkill.rowType),
    (ctx: any) => [...ctx.db.playerCraftSkill.identity.filter(ctx.sender)]);
  return { craftGradeGear, myCraftSkills };
}
