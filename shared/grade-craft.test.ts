import { describe, expect, it } from "vitest";
import {
  CRAFT_LINES, craftLevels, craftMaterialsKey, craftMaterialsShort, craftProgress, gradeCraftLevel, gradeCraftMaterials, gradeCraftNeed,
  gradeCraftSkill, isCraftable,
} from "./grade-craft";
import { CRAFT_MAX_LEVEL, craftExperienceForLevel, craftLevel } from "./crafting";
import { GRADE_EQUIPMENT_IDS } from "./grade-equipment";
import { gradeShopOffer } from "./grade-shop";

describe("crafting graded gear", () => {
  it("gives each craft its lines, every graded piece made by exactly one", () => {
    const ids = (skill: keyof typeof CRAFT_LINES) => CRAFT_LINES[skill].map(line => gradeShopOffer(line, new Set()).itemId);
    expect(ids("smithing")).toEqual(["common_sword", "common_medium_helmet", "common_medium_armor", "common_heavy_helmet", "common_heavy_armor"]);
    expect(ids("fletching")).toEqual(["common_bow", "common_light_helmet", "common_light_armor"]);
    expect(ids("enchanting")).toEqual(["common_staff", "common_magic_helmet", "common_magic_armor"]);
    expect(GRADE_EQUIPMENT_IDS.every(isCraftable)).toBe(true);
    expect(isCraftable("iron_bow")).toBe(false);
  });

  it("names a piece's craft, recipe and level", () => {
    expect(gradeCraftSkill("rare_light_helmet")).toBe("fletching");
    expect(gradeCraftSkill("rare_heavy_helmet")).toBe("smithing");
    expect(gradeCraftSkill("iron_bow")).toBeUndefined();
    expect(gradeCraftMaterials("common_staff")).toEqual({ pine_log: 10, arcane_crystal: 2 });
    expect(gradeCraftMaterials("epic_sword")).toEqual({ adamant_ore: 400, starshard: 2 });
    expect(gradeCraftMaterials("iron_bow")).toBeUndefined();
    expect(gradeCraftLevel("rare_bow")).toBe(20);
    expect(gradeCraftNeed("uncommon_magic_armor")).toBe("Lv 10 Enchanting");
  });

  it("compares recipes in one form whatever their order, and lists what is short", () => {
    expect(craftMaterialsKey({ pine_log: 20, copper_ore: 4 })).toBe(craftMaterialsKey({ copper_ore: 4, pine_log: 20 }));
    expect(craftMaterialsKey({ pine_log: 20 })).not.toBe(craftMaterialsKey({ pine_log: 21 }));
    expect(craftMaterialsShort({ pine_log: 20, copper_ore: 4 }, { pine_log: 20, copper_ore: 3 })).toEqual(["copper_ore"]);
    expect(craftMaterialsShort({ pine_log: 20 }, {})).toEqual(["pine_log"]);
  });

  it("starts every craft at level 1 and needs a craft for each early level", () => {
    expect(craftLevel(0)).toBe(1);
    expect(craftLevels({ smithing: 264n })).toEqual({ smithing: 10, fletching: 1, enchanting: 1 });
    for (let level = 2; level <= CRAFT_MAX_LEVEL; level++) expect(craftExperienceForLevel(level)).toBeGreaterThan(craftExperienceForLevel(level - 1));
    expect(craftProgress(0)).toEqual({ level: 1, into: 0, needed: 1 });
    expect(craftProgress(200)).toEqual({ level: 9, into: 23, needed: 87 });
    expect(craftProgress(craftExperienceForLevel(CRAFT_MAX_LEVEL) + 5)).toEqual({ level: CRAFT_MAX_LEVEL, into: 0, needed: 0 });
  });
});
