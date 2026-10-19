import { SWORD_DAMAGE_FACTOR, SWORD_REACH } from "./campaign-equipment";
import {
  ARMOR_CLASSES, ARMOR_CLASS_NAMES, GEAR_GRADES, GEAR_GRADE_NAMES, GRADE_BONUS_PERCENT, GRADE_ITEM_TIER,
  armorBonusPercent, isArmorClass, isGearGrade, type ArmorClass, type GearGrade,
} from "./gear-grades";
import type { ItemDefinition } from "./items";

/**
 * The graded gear: a bow, sword and staff per grade, and a helmet and armor per class and grade. Bought from the
 * Smith or crafted, never dropped, so no map's loot lists them. They are kept like the Smith's Starter Staff
 * (TOWN_DROP): in the bag, and can be thrown away.
 */
export const GRADE_WEAPON_KINDS = ["bow", "sword", "staff"] as const;
export type GradeWeaponKind = typeof GRADE_WEAPON_KINDS[number];
export const GRADE_ARMOR_KINDS = ["helmet", "armor"] as const;
export type GradeArmorKind = typeof GRADE_ARMOR_KINDS[number];
export type GradeEquipmentKind = GradeWeaponKind | GradeArmorKind;

export type GradeWeaponId = `${GearGrade}_${GradeWeaponKind}`;
export type GradeArmorId = `${GearGrade}_${ArmorClass}_${GradeArmorKind}`;
export type GradeItemId = GradeWeaponId | GradeArmorId;

/** Each piece's name after its grade, in grade order; each matches its art (scripts/art/grade-equipment.json). */
const WEAPON_NAMES: Readonly<Record<GradeWeaponKind, readonly string[]>> = {
  bow: ["Shortbow", "Hunting Bow", "Steel Bow", "Wingbow", "Crystal Bow", "Sunwing Bow"],
  sword: ["Iron Blade", "Broadsword", "Steel Sword", "Sawtooth Sword", "Ivory Sword", "Ruby Sword"],
  staff: ["Gnarled Staff", "Seer Staff", "Orb Staff", "Crystal Staff", "Star Staff", "Ramskull Staff"],
};
const ARMOR_NAMES: Readonly<Record<ArmorClass, Readonly<Record<GradeArmorKind, readonly string[]>>>> = {
  light: {
    helmet: ["Ranger Cap", "Ranger Hood", "Ranger Plume", "Antler Hood", "Wolf Hood", "Eagle Hood"],
    armor: ["Ranger Jerkin", "Fur Jerkin", "Ranger Tunic", "Ranger Cloak", "Beast Pelt", "Feather Mantle"],
  },
  medium: {
    helmet: ["Kettle Helm", "Sallet", "Nasal Helm", "Visored Helm", "Crested Helm", "Winged Helm"],
    armor: ["Chainmail", "Soldier Mail", "Steel Cuirass", "Tabard Mail", "Knight Cuirass", "Paladin Mail"],
  },
  heavy: {
    helmet: ["Pot Helm", "Great Helm", "Horned Helm", "Warden Helm", "Dread Helm", "Golden Helm"],
    armor: ["Iron Plate", "Strapped Plate", "Pauldron Plate", "Horned Plate", "Dread Plate", "Golden Plate"],
  },
  magic: {
    helmet: ["Pointed Hat", "Wizard Hat", "Silver Circlet", "Arcane Cowl", "Gold Circlet", "Violet Crown"],
    armor: ["Novice Robe", "Mystic Robe", "Arcane Robe", "Sorcerer Robe", "Starry Robe", "Archmage Robe"],
  },
};

const percentText = (percent: number) => Math.round(percent * 100) / 100;
const gradeName = (grade: GearGrade, names: readonly string[]) => `${GEAR_GRADE_NAMES[grade]} ${names[GEAR_GRADES.indexOf(grade)]}`.toUpperCase();

function gradeWeapon(grade: GearGrade, kind: GradeWeaponKind): ItemDefinition {
  const id = gradeItemId(kind, grade), name = gradeName(grade, WEAPON_NAMES[kind]), tier = GRADE_ITEM_TIER[grade];
  if (kind === "sword") {
    const percent = percentText(GRADE_BONUS_PERCENT[grade] * SWORD_DAMAGE_FACTOR);
    return {
      id, name, slot: "HAND", acquisition: "TOWN_DROP",
      description: "A sword that increases damage. It strikes up close.",
      stats: [`DAMAGE +${percent}%`], weapon: { mode: "MELEE", range: SWORD_REACH, damageMultiplierBonus: percent / 100, tier },
    };
  }
  const percent = percentText(GRADE_BONUS_PERCENT[grade]);
  return {
    id, name, slot: "HAND", acquisition: "TOWN_DROP",
    description: kind === "staff" ? "A staff that increases damage. Its bolts burst on whatever they hit." : "A bow that increases damage.",
    stats: [`DAMAGE +${percent}%`],
    weapon: { mode: "RANGED", projectile: kind === "staff" ? "BOLT" : "ARROW", damageMultiplierBonus: percent / 100, tier },
  };
}

function gradeArmor(grade: GearGrade, armorClass: ArmorClass, kind: GradeArmorKind): ItemDefinition {
  const percent = percentText(armorBonusPercent(grade, armorClass)), className = ARMOR_CLASS_NAMES[armorClass].toLowerCase();
  const base = { id: gradeItemId(kind, grade, armorClass), name: gradeName(grade, ARMOR_NAMES[armorClass][kind]), acquisition: "TOWN_DROP" as const };
  return kind === "helmet"
    ? { ...base, slot: "HEAD", description: `A ${className} helmet that increases regeneration.`, stats: [`REGEN +${percent}%`], modifiers: { regenerationMultiplierBonus: percent / 100 } }
    : { ...base, slot: "CHEST", description: `${ARMOR_CLASS_NAMES[armorClass]} armor that increases maximum health.`, stats: [`MAX HEALTH +${percent}%`], modifiers: { maxHealthMultiplierBonus: percent / 100 } };
}

/** The id of a graded piece: `rare_bow`, or `epic_light_helmet` with a class. */
export function gradeItemId(kind: GradeWeaponKind, grade: GearGrade): GradeWeaponId;
export function gradeItemId(kind: GradeArmorKind, grade: GearGrade, armorClass: ArmorClass): GradeArmorId;
export function gradeItemId(kind: GradeEquipmentKind, grade: GearGrade, armorClass?: ArmorClass): GradeItemId {
  return (armorClass ? `${grade}_${armorClass}_${kind}` : `${grade}_${kind}`) as GradeItemId;
}

export const GRADE_ITEM_DEFINITIONS = Object.fromEntries([
  ...GEAR_GRADES.flatMap(grade => GRADE_WEAPON_KINDS.map(kind => gradeWeapon(grade, kind))),
  ...GEAR_GRADES.flatMap(grade => ARMOR_CLASSES.flatMap(armorClass => GRADE_ARMOR_KINDS.map(kind => gradeArmor(grade, armorClass, kind)))),
].map(item => [item.id, item])) as { [Id in GradeItemId]: ItemDefinition & { id: Id } };

export const GRADE_EQUIPMENT_IDS = Object.keys(GRADE_ITEM_DEFINITIONS) as GradeItemId[];

const GRADE_IDS = new Set<string>(GRADE_EQUIPMENT_IDS);
export const isGradeItemId = (itemId: unknown): itemId is GradeItemId => typeof itemId === "string" && GRADE_IDS.has(itemId);

/** A graded piece's grade, or undefined for any other item. */
export function gradeOf(itemId: unknown): GearGrade | undefined {
  if (!isGradeItemId(itemId)) return undefined;
  const grade = itemId.slice(0, itemId.indexOf("_"));
  return isGearGrade(grade) ? grade : undefined;
}

/** A graded helmet's or armor's class, or undefined for weapons and any other item. */
export function armorClassOf(itemId: unknown): ArmorClass | undefined {
  if (!isGradeItemId(itemId)) return undefined;
  const armorClass = itemId.split("_")[1];
  return isArmorClass(armorClass) ? armorClass : undefined;
}

/** A graded piece's kind: bow, sword, staff, helmet or armor. */
export function gradeEquipmentKindOf(itemId: unknown): GradeEquipmentKind | undefined {
  return isGradeItemId(itemId) ? itemId.slice(itemId.lastIndexOf("_") + 1) as GradeEquipmentKind : undefined;
}
