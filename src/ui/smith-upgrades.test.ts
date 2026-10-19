import { expect, it } from "vitest";
import { GRADE_GOLD_PRICE } from "../../shared/gear-grades";
import type { GradeItemId } from "../../shared/grade-equipment";
import { gearComparison, gradeShortName, schoolLines, upgradeAllPlan } from "./smith-upgrades";

const plan = (options: { school?: "archery" | "swordplay" | "sorcery"; held?: string[]; levels?: Record<string, number>; gold: number; beats?: (itemId: GradeItemId) => boolean }) =>
  upgradeAllPlan({ lines: schoolLines(options.school ?? "archery"), held: new Set(options.held ?? []), levels: options.levels ?? {}, gold: options.gold, beats: options.beats ?? (() => true) });

it("names each school's own lines: its weapon, its class's helmet and armor, its boots", () => {
  expect(schoolLines("archery")).toEqual([{ kind: "bow" }, { kind: "helmet", armorClass: "light" }, { kind: "armor", armorClass: "light" }, { kind: "boots", bootStyle: "ranger" }]);
  expect(schoolLines("sorcery").map(line => "armorClass" in line ? line.armorClass : "bootStyle" in line ? line.bootStyle : line.kind)).toEqual(["staff", "magic", "magic", "mystic"]);
  expect(gradeShortName("rare_light_helmet")).toBe("Rare Light Helmet");
  expect(gradeShortName("epic_mystic_boots")).toBe("Epic Mystic Boots");
  expect(gradeShortName("crude_sword")).toBe("Crude Sword");
});

it("spreads the gold over the lines, raising the one furthest behind a grade at a time, one piece a line", () => {
  const result = plan({ levels: { archery: 6 }, gold: 600 });
  expect(result.picks.map(pick => pick.itemId)).toEqual(["sturdy_bow", "sturdy_light_helmet", "sturdy_light_armor", "sturdy_ranger_boots"]);
  expect(result.total).toBe(GRADE_GOLD_PRICE.sturdy * 4);
  // A line already ahead waits while the others catch up.
  const behind = plan({ levels: { archery: 6 }, gold: 600, held: ["rare_bow"] });
  expect(behind.picks.map(pick => pick.itemId).some(itemId => itemId.endsWith("_bow"))).toBe(false);
});

it("skips a line whose affordable grades are no better than what is worn, or that is held to the top", () => {
  const result = plan({ levels: { archery: 6 }, gold: 10_000, held: ["eternal_ranger_boots"], beats: itemId => !itemId.endsWith("_bow") });
  expect(result.picks.map(pick => pick.itemId)).toEqual(["exquisite_light_helmet", "exquisite_light_armor"]);
});

it("says what comes soonest when nothing is affordable: the cheapest upgrade's price, else the Mastery it needs", () => {
  expect(plan({ levels: { archery: 6 }, gold: 50 })).toEqual({ picks: [], total: 0, next: `Next: Crude Bow at ${GRADE_GOLD_PRICE.crude} Gold` });
  const held = ["crude_bow", "crude_light_helmet", "crude_light_armor", "crude_ranger_boots"];
  expect(plan({ gold: 10_000, held }).next).toBe("Next: Common Bow at Lv 1 Archery");
  const top = ["eternal_bow", "eternal_light_helmet", "eternal_light_armor", "eternal_ranger_boots"];
  expect(plan({ gold: 10_000, held: top }).next).toBe("Top Grade on Every Line");
});

it("compares an offer with the worn piece's stat at the slot's tier, and the worn refine", () => {
  expect(gearComparison("rare_bow", { equippedRightHand: "common_bow" }, { tier: 0, wornRefine: 0 })).toEqual({ delta: 24, label: "Damage", text: "+24% Damage vs Now" });
  expect(gearComparison("rare_light_helmet", {}, { tier: 0, wornRefine: 0 }).text).toBe("+28.8% Regen vs Now");
  expect(gearComparison("crude_warrior_boots", { equippedFeet: "rare_warrior_boots" }, { tier: 0, wornRefine: 0 }).delta).toBeLessThan(0);
  // Boots of another style give nothing of this one's stat.
  expect(gearComparison("crude_ranger_boots", { equippedFeet: "epic_warrior_boots" }, { tier: 0, wornRefine: 0 }).text).toBe("+2% Move Speed vs Now");
  expect(gearComparison("common_bow", { equippedRightHand: "common_bow" }, { tier: 0, wornRefine: 0 }).text).toBe("Same as Now");
  const tiered = gearComparison("rare_bow", { equippedRightHand: "common_bow" }, { tier: 10, wornRefine: 0 }).delta;
  expect(tiered).toBeGreaterThan(24);
});
