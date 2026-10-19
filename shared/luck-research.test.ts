import { describe, expect, it } from "vitest";
import { createEmptyResearchRanks, researchIsAvailable, researchPrerequisitesForNextRank, researchTreeFor, LUCK_RESEARCH_IDS } from "./research";
import { chanceWithLuck, luckMultiplier } from "./luck-research";
import { CARD_DROP_OUTCOMES, cardDropChance } from "./cards";
import { refineSafeLimit, refineSuccessChance, rollRefine } from "./refine";
import { MINING_NODES, MINING_STARSHARD_CHANCE, miningYield } from "./mining";
import { rollBowSkills } from "./bow-skills";
import { rollSwordSkills } from "./sword-skills";
import { rollWeaponSkills } from "./weapon-skills";
import { researchInPlayFor } from "./bonus-toggles";

describe("luck research prerequisites", () => {
  it("opens Bag Slots from Enemy Respawn rank 6 or Crit Cap rank 1, not Attack Range alone", () => {
    const ranks = { ...createEmptyResearchRanks(), utilityAttackRange: 5, enemyRespawn: 5 };
    expect(researchIsAvailable("inventorySlots", ranks)).toBe(false);
    expect(researchIsAvailable("inventorySlots", { ...ranks, enemyRespawn: 6 })).toBe(true);
    expect(researchIsAvailable("inventorySlots", { ...ranks, critCap: 1 })).toBe(true);
    expect(researchIsAvailable("inventorySlots", { ...ranks, critCap: 1, inventorySlots: 5 })).toBe(false);
  });

  it("opens Card and Gear Luck from Bag Slots, then Mining Luck from either, then Skill Luck", () => {
    const ranks = createEmptyResearchRanks();
    for (const id of LUCK_RESEARCH_IDS) {
      expect(researchTreeFor(id)).toBe("utility");
      expect(researchIsAvailable(id, ranks)).toBe(false);
    }
    ranks.inventorySlots = 1;
    expect(researchIsAvailable("cardLuck", ranks)).toBe(true);
    expect(researchIsAvailable("gearLuck", ranks)).toBe(true);
    expect(researchIsAvailable("miningLuck", ranks)).toBe(false);
    expect(researchIsAvailable("miningLuck", { ...ranks, gearLuck: 1 })).toBe(true);
    ranks.cardLuck = 1;
    expect(researchIsAvailable("miningLuck", ranks)).toBe(true);
    expect(researchIsAvailable("skillLuck", ranks)).toBe(false);
    ranks.miningLuck = 1;
    expect(researchIsAvailable("skillLuck", ranks)).toBe(true);
  });

  it("opens Card Luck's second band from Mining Luck, not from more Bag Slots", () => {
    const ranks = { ...createEmptyResearchRanks(), inventorySlots: 5, cardLuck: 5 };
    expect(researchPrerequisitesForNextRank("cardLuck", 5)).toEqual({ miningLuck: 1 });
    expect(researchIsAvailable("cardLuck", ranks)).toBe(false);
    ranks.miningLuck = 1;
    expect(researchIsAvailable("cardLuck", ranks)).toBe(true);
    expect(researchIsAvailable("cardLuck", { ...ranks, cardLuck: 10 })).toBe(false);
  });

  it("opens Refine Luck from Card Luck rank 6 or Skill Luck rank 1", () => {
    const ranks = { ...createEmptyResearchRanks(), inventorySlots: 1, cardLuck: 5, miningLuck: 1 };
    expect(researchIsAvailable("refineLuck", ranks)).toBe(false);
    expect(researchIsAvailable("refineLuck", { ...ranks, cardLuck: 6 })).toBe(true);
    expect(researchIsAvailable("refineLuck", { ...ranks, skillLuck: 1 })).toBe(true);
  });

  it("switches off with the other research bonuses", () => {
    const ranks = { ...createEmptyResearchRanks(), cardLuck: 4, refineLuck: 2 };
    expect(researchInPlayFor(ranks, new Set(["research.cardLuck"]))).toMatchObject({ cardLuck: 0, refineLuck: 2 });
  });
});

describe("luck effects", () => {
  it("multiplies by its percent a rank, clamped to the research's ranks", () => {
    expect(luckMultiplier("cardLuck", 0)).toBe(1);
    expect(luckMultiplier("cardLuck", 10)).toBeCloseTo(1.5);
    expect(luckMultiplier("cardLuck", 99)).toBeCloseTo(1.5);
    expect(luckMultiplier("gearLuck", 5)).toBeCloseTo(1.25);
    expect(luckMultiplier("miningLuck", 5)).toBeCloseTo(1.5);
    expect(luckMultiplier("refineLuck", -3)).toBe(1);
    expect(chanceWithLuck(.9, "miningLuck", 5)).toBe(1);
  });

  it("raises each card's drop chance by 5% a rank of Card Luck, never past certainty", () => {
    const outcomes = CARD_DROP_OUTCOMES.regular;
    expect(cardDropChance(outcomes, 1)).toBe(1 / outcomes);
    expect(cardDropChance(outcomes, 1, 10)).toBeCloseTo(1.5 / outcomes);
    expect(cardDropChance(outcomes, outcomes, 10)).toBe(1);
  });

  it("raises a risky refine by 2% a rank of Refine Luck, and leaves safe ones certain", () => {
    const bow = "ion_bow", risky = refineSafeLimit(bow) + 1;
    const base = refineSuccessChance(bow, risky);
    expect(base).toBeGreaterThan(0);
    expect(base).toBeLessThan(1);
    expect(refineSuccessChance(bow, risky, 5)).toBeCloseTo(base * 1.1);
    expect(refineSuccessChance(bow, risky - 1, 5)).toBe(1);
    expect(refineSuccessChance(bow, 0, 5)).toBe(0);
    const roll = base * 1.05;
    expect(rollRefine(bow, risky - 1, roll).succeeded).toBe(false);
    expect(rollRefine(bow, risky - 1, roll, 5).succeeded).toBe(true);
  });

  it("gives a Mysterious rock a 10% chance a rank of Mining Luck of a second Starshard", () => {
    const mysterious = MINING_NODES.find(node => node.kind === "mysterious")!;
    const roll = .4 * MINING_STARSHARD_CHANCE;
    expect(miningYield(mysterious, roll).starshard).toBe(1);
    expect(miningYield(mysterious, roll, {}, 1, 5).starshard).toBe(2);
    expect(miningYield(mysterious, roll, {}, 1, 3).starshard).toBe(1);
  });

  it("raises each weapon skill's appear chance by 5% a rank of Skill Luck, drawing as before", () => {
    // Appearance draws just past a third: no skill plain, every skill at Skill Luck 5 (5/12).
    const draws = () => { let draw = 0; return () => draw++ % 2 ? 0 : .4; };
    expect(rollBowSkills("ion_bow", draws())).toEqual({ arrowStorm: 0, ricochet: 0, piercingShot: 0 });
    expect(rollBowSkills("ion_bow", draws(), 5)).toEqual({ arrowStorm: 7, ricochet: 7, piercingShot: 7 });
    expect(rollSwordSkills("ion_sword", draws(), 5)).toEqual({ whirlwind: 7, deflect: 7, shockwave: 7 });
    expect(rollWeaponSkills("ion_bow", draws(), 5)).toEqual(rollBowSkills("ion_bow", draws(), 5));
    expect(rollBowSkills("ion_bow", draws(), 1)).toEqual(rollBowSkills("ion_bow", draws()));
  });
});
