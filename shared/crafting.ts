import { GEAR_GRADES, type ArmorClass, type GearGrade } from "./gear-grades";

/**
 * Crafting: the other way to graded gear. Each craft has its own skill, levelled by crafting, and its own station:
 * Smithing at the Smith (swords, Medium and Heavy armor), Fletching at the Archery Range (bows, Light armor),
 * Enchanting at the Mage Tower (staffs, Magic armor). The grade must still be open by Mastery, as for buying.
 */
export const CRAFT_SKILLS = ["smithing", "fletching", "enchanting"] as const;
export type CraftSkill = typeof CRAFT_SKILLS[number];
export const CRAFT_SKILL_NAMES: Readonly<Record<CraftSkill, string>> = { smithing: "Smithing", fletching: "Fletching", enchanting: "Enchanting" };

/** Wood from the Woodcutting trees, one kind per grade band, and crystal from the Copper Hills' crystal rocks. */
export const WOOD_IDS = ["pine_log", "oak_log", "yew_log", "elder_log"] as const;
export type WoodId = typeof WOOD_IDS[number];
export const ARCANE_CRYSTAL = "arcane_crystal" as const;
export const MATERIAL_NAMES: Readonly<Record<string, string>> = {
  pine_log: "Pine Log", oak_log: "Oak Log", yew_log: "Yew Log", elder_log: "Elder Log", arcane_crystal: "Arcane Crystal",
  copper_ore: "Copper Ore", iron_ore: "Iron Ore", mithril_ore: "Mithril Ore", adamant_ore: "Adamant Ore", starshard: "Starshard",
};

export type CraftKind = "bow" | "sword" | "staff" | "helmet" | "armor";
export type Materials = Readonly<Record<string, number>>;

/** The craft that makes a piece. */
export function craftSkillFor(kind: CraftKind, armorClass?: ArmorClass): CraftSkill {
  if (kind === "bow") return "fletching";
  if (kind === "staff") return "enchanting";
  if (kind === "sword") return "smithing";
  return armorClass === "light" ? "fletching" : armorClass === "magic" ? "enchanting" : "smithing";
}

/** The craft skill level a grade needs. */
export const CRAFT_LEVEL: Readonly<Record<GearGrade, number>> = { common: 1, uncommon: 10, rare: 20, epic: 35, legendary: 50, mythic: 70 };

/** Each grade's band: which ore and wood it takes, and how many. Higher grades add Starshards. */
const BANDS: Readonly<Record<GearGrade, { ore: string; wood: WoodId; amount: number; starshards: number; crystals: number }>> = {
  common: { ore: "copper_ore", wood: "pine_log", amount: 20, starshards: 0, crystals: 2 },
  uncommon: { ore: "iron_ore", wood: "oak_log", amount: 60, starshards: 0, crystals: 6 },
  rare: { ore: "mithril_ore", wood: "yew_log", amount: 150, starshards: 0, crystals: 15 },
  epic: { ore: "adamant_ore", wood: "elder_log", amount: 400, starshards: 2, crystals: 40 },
  legendary: { ore: "adamant_ore", wood: "elder_log", amount: 1_000, starshards: 6, crystals: 100 },
  mythic: { ore: "adamant_ore", wood: "elder_log", amount: 2_500, starshards: 20, crystals: 250 },
};

/**
 * What a piece costs to craft. Smithing is all ore; Fletching mostly wood with a little ore for fittings;
 * Enchanting wood for the haft and crystal for the focus. Helmets take half of what armor and weapons do.
 */
export function craftMaterials(grade: GearGrade, kind: CraftKind, armorClass?: ArmorClass): Materials {
  const band = BANDS[grade], share = kind === "helmet" ? .5 : 1, skill = craftSkillFor(kind, armorClass);
  const n = (value: number) => Math.max(1, Math.round(value * share));
  const materials: Record<string, number> = {};
  if (skill === "smithing") materials[band.ore] = n(band.amount);
  if (skill === "fletching") { materials[band.wood] = n(band.amount); materials[band.ore] = n(band.amount / 5); }
  if (skill === "enchanting") { materials[band.wood] = n(band.amount / 2); materials[ARCANE_CRYSTAL] = n(band.crystals); }
  if (band.starshards) materials.starshard = n(band.starshards);
  return materials;
}

/** What a craft gives: a refine to start, and a weapon's skills rolled twice with better luck, keeping the higher. */
export const CRAFTED_REFINE = 2;
export const CRAFTED_SKILL_LUCK_RANKS = 3;

/** Craft experience a piece gives, so each grade levels the craft toward the next. */
export const craftExperience = (grade: GearGrade) => 25 * 4 ** GEAR_GRADES.indexOf(grade);

export const CRAFT_MAX_LEVEL = 99;
/**
 * Total experience to reach a craft level. Each grade's crafts carry you toward the next grade's level: about 11
 * Common crafts to 10, 30 Uncommon to 20, 50 Rare to 35, 37 Epic to 50, 29 Legendary to 70.
 */
export function craftExperienceForLevel(level: number) {
  const clamped = Math.max(1, Math.min(CRAFT_MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)));
  // Rounded up, so level 2 takes a craft rather than none.
  return Math.ceil(.15 * (clamped - 1) ** 3.4);
}
export function craftLevel(experience: number | bigint) {
  const value = Math.max(0, Number(experience) || 0);
  let level = 1;
  while (level < CRAFT_MAX_LEVEL && value >= craftExperienceForLevel(level + 1)) level++;
  return level;
}
