import { expect, it } from "vitest";
import { isSkillSword, rollSwordSkills, swordSkillBossDamageMultiplier, swordSkillChance, swordSkillLines, swordSkillReachMultiplier } from "./sword-skills";
import { weaponSkillLines, weaponSkillScore } from "./weapon-skills";

it("rolls sword copies in their tier's range and never gives sword skills to a bow or cosmetic", () => {
  expect(rollSwordSkills("wooden_sword", () => 0)).toEqual({ whirlwind: 1, deflect: 1, shockwave: 1 });
  let draw = 0;
  expect(rollSwordSkills("ion_sword", () => draw++ % 2 ? .999 : 0)).toEqual({ whirlwind: 15, deflect: 15, shockwave: 15 });
  expect(rollSwordSkills("ion_sword", () => .999)).toEqual({ whirlwind: 0, deflect: 0, shockwave: 0 });
  expect(rollSwordSkills("ion_bow", () => 0)).toBeNull();
  expect(isSkillSword("starter_stone")).toBe(false);
});

it("uses percentages consistently for display, scoring and combat bounds", () => {
  const roll = { whirlwind: 10, deflect: 10, shockwave: 10 };
  expect(swordSkillLines(roll)).toEqual(["Whirlwind 10.0%", "Deflect 10.0%", "Shockwave 10.0%"]);
  expect(swordSkillBossDamageMultiplier(roll)).toBeCloseTo(1.215);
  expect(swordSkillReachMultiplier(roll)).toBeCloseTo(3.2);
  expect(weaponSkillScore("ion_sword", roll)).toBe(53);
  expect(weaponSkillLines("ion_bow", roll)).toEqual([]);
  expect(swordSkillChance({ deflect: NaN }, "deflect")).toBe(0);
});
