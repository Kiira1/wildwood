import { describe, expect, it } from "vitest";
import { equipmentStatDefinition } from "./equipment-budget";
import { armorBonusPercent, armorClassMasteryLevel, gradeForOldBonus, highestGradeFor, oldTierSalePrice } from "./gear-grades";

const oldBonus = (tier: number) => (equipmentStatDefinition(tier, "HEAD").modifiers!.regenerationMultiplierBonus as number) * 100;

describe("gear grades", () => {
  it("converts an old piece to the grade nearest its own bonus, so nobody gains or loses much", () => {
    expect(gradeForOldBonus(oldBonus(1))).toBe("common");
    expect(gradeForOldBonus(oldBonus(15))).toBe("legendary");
    expect(gradeForOldBonus(oldBonus(10))).toBe("epic");
    for (let tier = 1; tier <= 15; tier++) expect(gradeForOldBonus(oldBonus(tier))).toBeTruthy();
  });

  it("opens grades by Mastery level, Heavy by the best school", () => {
    expect(highestGradeFor(0)).toBe("common");
    expect(highestGradeFor(19)).toBe("rare");
    expect(highestGradeFor(50)).toBe("mythic");
    expect(armorClassMasteryLevel("light", { archery: 12, swordplay: 30 })).toBe(12);
    expect(armorClassMasteryLevel("heavy", { archery: 12, swordplay: 30 })).toBe(30);
    expect(armorClassMasteryLevel("heavy", {})).toBe(0);
  });

  it("trades bonus for each class's perk", () => {
    expect(armorBonusPercent("epic", "medium")).toBe(50);
    expect(armorBonusPercent("epic", "heavy")).toBe(65);
    expect(armorBonusPercent("epic", "light")).toBe(40);
  });

  it("pays more for higher old tiers", () => {
    expect(oldTierSalePrice(1)).toBe(10);
    expect(oldTierSalePrice(15)).toBe(2250);
  });
});
