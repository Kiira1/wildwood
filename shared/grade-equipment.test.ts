import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SWORD_DAMAGE_FACTOR, SWORD_REACH } from "./campaign-equipment";
import {
  ARMOR_CLASSES, BOOT_MOVE_SPEED_PERCENT, BOOT_SKILL_CHANCE_PERCENT, BOOT_STYLES, GEAR_GRADES, GRADE_BONUS_PERCENT, GRADE_ITEM_TIER, armorBonusPercent,
} from "./gear-grades";
import {
  GRADE_ARMOR_KINDS, GRADE_EQUIPMENT_IDS, GRADE_WEAPON_KINDS, armorClassOf, bootStyleOf, gradeEquipmentKindOf, gradeItemId, gradeOf,
} from "./grade-equipment";
import { EQUIPMENT_DROP_ITEM_IDS, canonicalItemId, itemDefinition } from "./items";
import { itemTier } from "./item-tier";
import { MAP_IDS } from "./rules";
import { regularMapLoot } from "./regular-map-loot";
import { GRADE_SKINS, gradeItemSkin, itemPresentation, type GradeSkin } from "../src/game/item-presentation";
import { gradeBootLegs } from "../src/game/campaign-item-presentation";

const root = join(import.meta.dirname, "..");
/** The vendor-art pieces; boots are the game's own boot recoloured (scripts/art/grade-boots.json). */
const VENDOR_IDS = GRADE_EQUIPMENT_IDS.filter(id => !bootStyleOf(id));
const BOOT_IDS = GRADE_EQUIPMENT_IDS.filter(id => bootStyleOf(id));

describe("graded gear", () => {
  it("has a bow, sword and staff per grade, a helmet and armor per class and grade, and boots per style and grade", () => {
    expect(GRADE_EQUIPMENT_IDS).toHaveLength(15 * 3 + 15 * 4 * 2 + 15 * 3);
    expect(gradeItemId("boots", "rare", "ranger")).toBe("rare_ranger_boots");
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
    for (const grade of GEAR_GRADES) for (const style of BOOT_STYLES) {
      const id = gradeItemId("boots", grade, style);
      expect([gradeOf(id), armorClassOf(id), bootStyleOf(id), gradeEquipmentKindOf(id)]).toEqual([grade, undefined, style, "boots"]);
    }
    expect([gradeOf("ion_bow"), armorClassOf("ion_helmet"), gradeOf(undefined), bootStyleOf("black_boots"), bootStyleOf("rare_light_armor")])
      .toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("gives Ranger Boots move speed, Warrior Boots armor and Mystic Boots skill chance, rising with the grade", () => {
    for (const grade of GEAR_GRADES) {
      const ranger = itemDefinition(gradeItemId("boots", grade, "ranger"))!, warrior = itemDefinition(gradeItemId("boots", grade, "warrior"))!;
      const mystic = itemDefinition(gradeItemId("boots", grade, "mystic"))!;
      for (const boots of [ranger, warrior, mystic]) expect([boots.slot, boots.acquisition]).toEqual(["FEET", "TOWN_DROP"]);
      expect(ranger.modifiers).toEqual({ moveSpeedMultiplierBonus: BOOT_MOVE_SPEED_PERCENT[grade] / 100 });
      expect(warrior.modifiers).toEqual({ armorMultiplierBonus: GRADE_BONUS_PERCENT[grade] / 100 });
      expect(mystic.modifiers).toEqual({ skillChanceMultiplierBonus: BOOT_SKILL_CHANCE_PERCENT[grade] / 100 });
      expect(ranger.stats).toEqual([`MOVE SPEED +${BOOT_MOVE_SPEED_PERCENT[grade]}%`]);
      expect(warrior.stats).toEqual([`ARMOR +${GRADE_BONUS_PERCENT[grade]}%`]);
      expect(mystic.stats).toEqual([`SKILL CHANCE +${BOOT_SKILL_CHANCE_PERCENT[grade]}%`]);
    }
    expect([BOOT_MOVE_SPEED_PERCENT.crude, BOOT_MOVE_SPEED_PERCENT.eternal, BOOT_SKILL_CHANCE_PERCENT.crude, BOOT_SKILL_CHANCE_PERCENT.eternal]).toEqual([2, 20, 2, 30]);
    GEAR_GRADES.slice(1).forEach((grade, index) => {
      expect(BOOT_MOVE_SPEED_PERCENT[grade]).toBeGreaterThan(BOOT_MOVE_SPEED_PERCENT[GEAR_GRADES[index]]);
      expect(BOOT_SKILL_CHANCE_PERCENT[grade]).toBeGreaterThan(BOOT_SKILL_CHANCE_PERCENT[GEAR_GRADES[index]]);
    });
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
    expect(itemDefinition("epic_light_helmet")?.name).toBe("EPIC RAMSHORN HOOD");
    expect(itemDefinition("eternal_bow")?.name).toBe("ETERNAL STORMWING BOW");
    expect(itemDefinition("crude_heavy_armor")?.name).toBe("CRUDE BARREL PLATE");
    expect(itemDefinition("rare_ranger_boots")?.name).toBe("RARE STALKER BOOTS");
    expect(itemDefinition("eternal_mystic_boots")?.name).toBe("ETERNAL ARCHMAGE BOOTS");
    for (const id of GRADE_EQUIPMENT_IDS) expect(itemDefinition(id)?.name.startsWith(gradeOf(id)!.toUpperCase() + " ")).toBe(true);
    expect(new Set(GRADE_EQUIPMENT_IDS.map(id => itemDefinition(id)?.name)).size).toBe(GRADE_EQUIPMENT_IDS.length);
  });

  it("is in no map's loot", () => {
    for (const mapId of MAP_IDS) for (const { itemId } of regularMapLoot(mapId)) expect(GRADE_EQUIPMENT_IDS).not.toContain(itemId);
    for (const id of GRADE_EQUIPMENT_IDS) expect(itemTier(id)).toBeUndefined();
  });

  it.each(GRADE_EQUIPMENT_IDS)("draws %s from its own art on disk, with a ★10 and a ★20 look beside it", id => {
    const source = itemPresentation(id)?.inventory.source;
    expect(source).toBe(`assets/wildstat/player-parts/${id.replace(/_/g, "-")}.webp`);
    for (const skin of GRADE_SKINS) {
      const art = gradeItemSkin(id, skin === "r20" ? 20 : skin === "r10" ? 10 : 0)!;
      expect(art).toBe(source!.replace(".webp", skin === "base" ? ".webp" : `-${skin}.webp`));
      expect(existsSync(join(root, "public", art)), art).toBe(true);
    }
  });

  it("ships no art for grades that are gone", () => {
    const parts = readdirSync(join(root, "public/assets/wildstat/player-parts"));
    expect(parts.filter(file => /^uncommon-/.test(file))).toEqual([]);
    const graded = parts.filter(file => /^[a-z]+-(bow|sword|staff|(light|medium|heavy|magic)-(helmet|armor))(-r10|-r20)?\.webp$/.test(file)
      && (GEAR_GRADES as readonly string[]).includes(file.split("-")[0]));
    expect(graded).toHaveLength(VENDOR_IDS.length * 3);
    const boots = parts.filter(file => /^[a-z]+-(ranger|warrior|mystic)-boots(-leg-front|-leg-back)?(-r10|-r20)?\.webp$/.test(file));
    expect(boots).toHaveLength(BOOT_IDS.length * 3 * 3);
  });

  it.each(BOOT_IDS)("walks %s on its own legs, with a ★10 and a ★20 look", id => {
    const world = itemPresentation(id)?.world;
    expect(world).toEqual(gradeBootLegs(id));
    for (const refine of [0, 10, 20]) {
      const legs = gradeBootLegs(id, refine);
      expect(itemPresentation(id, refine)?.world).toEqual(legs);
      for (const art of [legs.frontSource, legs.backSource]) expect(existsSync(join(root, "public", art)), art).toBe(true);
    }
    expect(gradeBootLegs(id, 10).frontSource).toMatch(/-leg-front-r10\.webp$/);
  });

  describe("the boots art manifest", () => {
    const { pieces } = JSON.parse(readFileSync(join(root, "scripts/art/grade-boots.json"), "utf8")) as
      { pieces: Record<string, { fill: string; details: string[] }> };

    it("lists every pair, a different leather for each and more on it as the grade rises", () => {
      expect(Object.keys(pieces).sort()).toEqual([...BOOT_IDS].sort());
      expect(new Set(Object.values(pieces).map(piece => piece.fill)).size).toBe(BOOT_IDS.length);
      for (const style of BOOT_STYLES) GEAR_GRADES.slice(1).forEach((grade, index) => {
        expect(pieces[gradeItemId("boots", grade, style)].details.length)
          .toBeGreaterThanOrEqual(pieces[gradeItemId("boots", GEAR_GRADES[index], style)].details.length);
      });
    });

    it("never draws the same picture for two looks", () => {
      const pictures = BOOT_IDS.flatMap(id => [0, 10, 20].map(refine => readFileSync(join(root, "public", gradeBootLegs(id, refine).frontSource)).toString("base64")));
      expect(new Set(pictures).size).toBe(BOOT_IDS.length * 3);
    });
  });

  describe("the art manifest", () => {
    type Look = string | { source: string; tint?: string; hue?: number; keepGold?: boolean };
    const { pieces } = JSON.parse(readFileSync(join(root, "scripts/art/grade-equipment.json"), "utf8")) as
      { pieces: Record<string, Record<GradeSkin, Look>> };
    const looks = (id: string) => GRADE_SKINS.map(skin => typeof pieces[id][skin] === "string" ? { source: pieces[id][skin] as string } : pieces[id][skin] as Exclude<Look, string>);
    const design = (source: string) => /_(\d+)(?:_[^/]*)?\.png$/.exec(source)![1].padStart(3, "0");
    const key = (look: Exclude<Look, string>) => `${look.source}|${look.tint ?? ""}|${look.hue ?? ""}|${look.keepGold ? "k" : ""}`;

    it("lists every piece", () => {
      expect(Object.keys(pieces).sort()).toEqual([...VENDOR_IDS].sort());
    });

    it("gives each piece three looks of one design", () => {
      for (const id of VENDOR_IDS) {
        const [base, ...skins] = looks(id);
        for (const skin of skins) expect(design(skin.source), id).toBe(design(base.source));
      }
    });

    it("never shows the same picture for two looks anywhere in the catalog", () => {
      const all = VENDOR_IDS.flatMap(id => looks(id).map(key));
      expect(new Set(all).size).toBe(VENDOR_IDS.length * 3);
    });

    it("uses a different design for every grade of a weapon, and of a class's helmet or armor", () => {
      for (const kind of GRADE_WEAPON_KINDS) {
        expect(new Set(GEAR_GRADES.map(grade => design(looks(gradeItemId(kind, grade))[0].source))).size, kind).toBe(GEAR_GRADES.length);
      }
      for (const armorClass of ARMOR_CLASSES) for (const kind of GRADE_ARMOR_KINDS) {
        const designs = GEAR_GRADES.map(grade => design(looks(gradeItemId(kind, grade, armorClass))[0].source));
        expect(new Set(designs).size, `${armorClass} ${kind}`).toBe(GEAR_GRADES.length);
      }
    });
  });
});
