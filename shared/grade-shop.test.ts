import { describe, expect, it } from "vitest";
import { GRADE_SHOP_LINES, gradeShopNeed, gradeShopOffer, gradeShopOpen, gradeShopPrice, masteryLevels } from "./grade-shop";
import { GRADE_EQUIPMENT_IDS } from "./grade-equipment";
import { masteryPointsForLevel } from "./weapon-mastery";

describe("the Smith's gear for gold", () => {
  it("has a line for every graded piece: three weapons, a helmet and armor per class", () => {
    expect(GRADE_SHOP_LINES).toHaveLength(11);
    const offered = GRADE_SHOP_LINES.map(line => gradeShopOffer(line, new Set()).itemId);
    expect(offered.every(id => GRADE_EQUIPMENT_IDS.includes(id))).toBe(true);
    expect(new Set(offered).size).toBe(11);
  });

  it("offers the grade after the best one held, and the top one as held", () => {
    const bow = GRADE_SHOP_LINES[0];
    expect(gradeShopOffer(bow, new Set())).toEqual({ itemId: "common_bow", grade: "common", owned: false });
    expect(gradeShopOffer(bow, new Set(["common_bow", "epic_bow"]))).toEqual({ itemId: "legendary_bow", grade: "legendary", owned: false });
    expect(gradeShopOffer(bow, new Set(["mythic_bow"]))).toEqual({ itemId: "mythic_bow", grade: "mythic", owned: true });
  });

  it("opens a grade by the piece's school, and Heavy by the best school", () => {
    const levels = masteryLevels({ archery: BigInt(masteryPointsForLevel(10)), sorcery: 0n });
    expect(levels).toEqual({ archery: 10, sorcery: 0 });
    expect(gradeShopOpen("rare_bow", levels)).toBe(true);
    expect(gradeShopOpen("uncommon_staff", levels)).toBe(false);
    expect(gradeShopOpen("rare_light_armor", levels)).toBe(true);
    expect(gradeShopOpen("rare_heavy_helmet", levels)).toBe(true);
    expect(gradeShopOpen("uncommon_medium_helmet", levels)).toBe(false);
    expect(gradeShopNeed("epic_sword")).toBe("Lv 20 Swordplay");
    expect(gradeShopNeed("epic_magic_helmet")).toBe("Lv 20 Sorcery");
    expect(gradeShopNeed("epic_heavy_armor")).toBe("Lv 20 In Any School");
  });

  it("prices only graded gear", () => {
    expect(gradeShopPrice("mythic_staff")).toBe(150_000);
    expect(gradeShopPrice("iron_bow")).toBeUndefined();
    expect(gradeShopPrice(undefined)).toBeUndefined();
  });
});
