import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SWORD_DAMAGE_FACTOR, SWORD_REACH } from "./campaign-equipment";
import { ARMOR_CLASSES, GEAR_GRADES, GRADE_BONUS_PERCENT, GRADE_ITEM_TIER, armorBonusPercent } from "./gear-grades";
import {
  GRADE_ARMOR_KINDS, GRADE_EQUIPMENT_IDS, GRADE_WEAPON_KINDS, armorClassOf, gradeEquipmentKindOf, gradeItemId, gradeOf,
} from "./grade-equipment";
import { EQUIPMENT_DROP_ITEM_IDS, canonicalItemId, itemDefinition } from "./items";
import { itemTier } from "./item-tier";
import { MAP_IDS } from "./rules";
import { regularMapLoot } from "./regular-map-loot";
import { itemPresentation } from "../src/game/item-presentation";

const root = join(import.meta.dirname, "..");

describe("graded gear", () => {
  it("has a bow, sword and staff per grade and a helmet and armor per class and grade", () => {
    expect(GRADE_EQUIPMENT_IDS).toHaveLength(18 + 48);
    expect(new Set(GRADE_EQUIPMENT_IDS).size).toBe(GRADE_EQUIPMENT_IDS.length);
    expect(gradeItemId("bow", "rare")).toBe("rare_bow");
    expect(gradeItemId("helmet", "epic", "light")).toBe("epic_light_helmet");
  });

  it.each(GRADE_EQUIPMENT_IDS)("resolves %s in the catalog, kept in the bag like a drop", id => {
    expect(itemDefinition(id)?.id).toBe(id);
    expect(canonicalItemId(id)).toBe(id);
    expect(EQUIPMENT_DROP_ITEM_IDS).toContain(id);
  });

  it("round-trips grade, class and kind from every id", () => {
    for (const grade of GEAR_GRADES) {
      for (const kind of GRADE_WEAPON_KINDS) {
        const id = gradeItemId(kind, grade);
        expect([gradeOf(id), armorClassOf(id), gradeEquipmentKindOf(id)]).toEqual([grade, undefined, kind]);
      }
      for (const armorClass of ARMOR_CLASSES) for (const kind of GRADE_ARMOR_KINDS) {
        const id = gradeItemId(kind, grade, armorClass);
        expect([gradeOf(id), armorClassOf(id), gradeEquipmentKindOf(id)]).toEqual([grade, armorClass, kind]);
      }
    }
    expect([gradeOf("ion_bow"), armorClassOf("ion_helmet"), gradeOf(undefined)]).toEqual([undefined, undefined, undefined]);
  });

  it("gives weapons the grade's damage bonus, swords half as much again, with the grade's stand-in tier", () => {
    for (const grade of GEAR_GRADES) {
      const bow = itemDefinition(gradeItemId("bow", grade))!, sword = itemDefinition(gradeItemId("sword", grade))!;
      const staff = itemDefinition(gradeItemId("staff", grade))!;
      expect(bow.weapon).toEqual({ mode: "RANGED", projectile: "ARROW", damageMultiplierBonus: GRADE_BONUS_PERCENT[grade] / 100, tier: GRADE_ITEM_TIER[grade] });
      expect(staff.weapon).toEqual({ mode: "RANGED", projectile: "BOLT", damageMultiplierBonus: GRADE_BONUS_PERCENT[grade] / 100, tier: GRADE_ITEM_TIER[grade] });
      expect(sword.weapon?.mode).toBe("MELEE");
      expect(sword.weapon?.range).toBe(SWORD_REACH);
      expect(sword.weapon?.tier).toBe(GRADE_ITEM_TIER[grade]);
      expect(sword.weapon?.damageMultiplierBonus).toBeCloseTo(GRADE_BONUS_PERCENT[grade] * SWORD_DAMAGE_FACTOR / 100, 8);
      expect(bow.stats).toEqual([`DAMAGE +${GRADE_BONUS_PERCENT[grade]}%`]);
    }
  });

  it("gives helmets regen and armor max health by the class's share of the grade", () => {
    for (const grade of GEAR_GRADES) for (const armorClass of ARMOR_CLASSES) {
      const percent = armorBonusPercent(grade, armorClass);
      const helmet = itemDefinition(gradeItemId("helmet", grade, armorClass))!;
      const armor = itemDefinition(gradeItemId("armor", grade, armorClass))!;
      expect(helmet.slot).toBe("HEAD");
      expect(helmet.modifiers?.regenerationMultiplierBonus).toBeCloseTo(percent / 100, 8);
      expect(armor.slot).toBe("CHEST");
      expect(armor.modifiers?.maxHealthMultiplierBonus).toBeCloseTo(percent / 100, 8);
    }
  });

  it("shows the grade in every name", () => {
    expect(itemDefinition("epic_light_helmet")?.name).toBe("EPIC ANTLER HOOD");
    for (const id of GRADE_EQUIPMENT_IDS) expect(itemDefinition(id)?.name.startsWith(gradeOf(id)!.toUpperCase() + " ")).toBe(true);
    expect(new Set(GRADE_EQUIPMENT_IDS.map(id => itemDefinition(id)?.name)).size).toBe(GRADE_EQUIPMENT_IDS.length);
  });

  it("is in no map's loot", () => {
    for (const mapId of MAP_IDS) for (const { itemId } of regularMapLoot(mapId)) expect(GRADE_EQUIPMENT_IDS).not.toContain(itemId);
    for (const id of GRADE_EQUIPMENT_IDS) expect(itemTier(id)).toBeUndefined();
  });

  it.each(GRADE_EQUIPMENT_IDS)("draws %s from its own art on disk", id => {
    const source = itemPresentation(id)?.inventory.source;
    expect(source).toBe(`assets/wildstat/player-parts/${id.replace(/_/g, "-")}.webp`);
    expect(existsSync(join(root, "public", source!))).toBe(true);
  });

  it("records a different vendor part for every piece", () => {
    const manifest = JSON.parse(readFileSync(join(root, "scripts/art/grade-equipment.json"), "utf8")) as Record<string, { source: string }>;
    expect(Object.keys(manifest).sort()).toEqual([...GRADE_EQUIPMENT_IDS].sort());
    expect(new Set(Object.values(manifest).map(entry => entry.source)).size).toBe(GRADE_EQUIPMENT_IDS.length);
  });
});
