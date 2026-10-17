import { describe, expect, it } from "vitest";
import { mergeSkillRolls } from "./weapon-skills";
import { IRON_BOW } from "./items";

const bow = (arrowStorm: number, ricochet: number, piercingShot: number) => ({ arrowStorm, ricochet, piercingShot });

describe("a duplicate's skills merged into the held weapon", () => {
  it("takes a roll that is at least as good on every skill", () => {
    expect(mergeSkillRolls(IRON_BOW, bow(2, 2, 0), bow(5, 5, 5))).toEqual(bow(5, 5, 5));
    expect(mergeSkillRolls(IRON_BOW, bow(2, 2, 2), bow(2, 2, 3))).toEqual(bow(2, 2, 3));
  });

  it("adds a missing skill at the drop's chance and leaves the high ones alone", () => {
    // Two high skills and a bow with three low ones: the third is added, low.
    expect(mergeSkillRolls(IRON_BOW, bow(9, 9, 0), bow(2, 2, 2))).toEqual(bow(9, 9, 2));
  });

  it("takes each better skill on its own, never lowering another", () => {
    // A drop with one high skill raises that one and leaves the rest.
    expect(mergeSkillRolls(IRON_BOW, bow(2, 2, 2), bow(9, 0, 0))).toEqual(bow(9, 2, 2));
    expect(mergeSkillRolls(IRON_BOW, bow(2, 2, 0), bow(9, 0, 4))).toEqual(bow(9, 2, 4));
    // A 1/15/15 bow and a 15/1/1 drop make 15/15/15.
    expect(mergeSkillRolls(IRON_BOW, bow(1, 15, 15), bow(15, 1, 1))).toEqual(bow(15, 15, 15));
  });

  it("changes nothing for an equal or worse roll, or for gear without skills", () => {
    expect(mergeSkillRolls(IRON_BOW, bow(3, 3, 3), bow(3, 3, 3))).toBeNull();
    expect(mergeSkillRolls(IRON_BOW, bow(3, 3, 3), bow(1, 1, 1))).toBeNull();
    expect(mergeSkillRolls("wooden_armor", bow(0, 0, 0), bow(5, 5, 5))).toBeNull();
  });
});
