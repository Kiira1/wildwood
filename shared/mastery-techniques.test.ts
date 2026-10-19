import { describe, expect, it } from "vitest";
import {
  BLOODLUST_HEAL_SHARE, MANA_SHIELD_REDUCTION, MARK_DAMAGE_BONUS, MOMENTUM_MAX, PARRY_RETURN_BONUS, duelMasteryFold, duelSkillsWithTechniques,
  hasTechnique, masteryCritEvery, masteryDamageTakenAt, masteryMarks, masteryTechniqueBound, type MasteryTechniqueId,
} from "./mastery-techniques";
import { MASTERY_MAX_LEVEL, SCHOOL_DETAILS, WEAPON_SCHOOLS, techniquesAt, type MasteryInPlay } from "./weapon-mastery";
import { ARROW_STORM_ARROWS, bowSkillReachMultiplier } from "./bow-skills";
import { WHIRLWIND_MAX_TARGETS, WHIRLWIND_TICKS, swordSkillReachMultiplier } from "./sword-skills";
import { METEOR_MAX_TARGETS, staffSkillReachMultiplier } from "./staff-skills";

const at = (school: MasteryInPlay["school"], level: number): MasteryInPlay => ({ school, level });

describe("mastery techniques", () => {
  it("are learned exactly as the school window lists them, only for the school in hand", () => {
    for (const school of WEAPON_SCHOOLS) for (let level = 0; level <= MASTERY_MAX_LEVEL; level++) {
      const learned = techniquesAt(school, level).map(technique => technique.id);
      for (const other of WEAPON_SCHOOLS) for (const technique of SCHOOL_DETAILS[other].techniques) {
        expect(hasTechnique(at(school, level), technique.id as MasteryTechniqueId)).toBe(other === school && learned.includes(technique.id));
      }
    }
    expect(hasTechnique(null, "steadyAim")).toBe(false);
  });

  it("forces every sixth arrow or bolt to crit from level 10, and marks on crits from 30", () => {
    expect(masteryCritEvery(at("archery", 9))).toBe(0);
    expect(masteryCritEvery(at("archery", 10))).toBe(6);
    expect(masteryCritEvery(at("sorcery", 10))).toBe(6);
    expect(masteryCritEvery(at("swordplay", 50))).toBe(0);
    expect(masteryMarks(at("archery", 29))).toBe(false);
    expect(masteryMarks(at("archery", 30))).toBe(true);
    expect(masteryMarks(at("sorcery", 30))).toBe(true);
  });

  it("Mana Shield takes 5% off while above half health, on top of nothing else for a staff", () => {
    expect(masteryDamageTakenAt(at("sorcery", 40), 51, 100)).toBeCloseTo(1 - MANA_SHIELD_REDUCTION);
    expect(masteryDamageTakenAt(at("sorcery", 40), 50, 100)).toBe(1);
    expect(masteryDamageTakenAt(at("sorcery", 39), 100, 100)).toBe(1);
    // Swordplay's Guard is all a sword brings.
    expect(masteryDamageTakenAt(at("swordplay", 50), 100, 100)).toBeCloseTo(.9);
  });

  it("leaves the kill bound alone without techniques, and opens it at each one's most", () => {
    const none = masteryTechniqueBound(at("archery", 9), true);
    expect(none).toEqual({ crits: false, damage: 1, attackSpeed: 1, stormWaves: 0, whirlwindTicks: 0, meteorFalls: 0, cleave: 0,
      deflectReturn: 1, healPerSwing: 0, guard: 1 });
    const archery = masteryTechniqueBound(at("archery", 50), true);
    expect(archery).toMatchObject({ crits: true, stormWaves: 1 });
    expect(archery.damage).toBeCloseTo((1 + MARK_DAMAGE_BONUS) * 1.15);
    // Volley only raises a Split Shot arrow.
    expect(masteryTechniqueBound(at("archery", 50), false).damage).toBeCloseTo(1 + MARK_DAMAGE_BONUS);
    expect(masteryTechniqueBound(at("swordplay", 50), true)).toMatchObject({ crits: false, damage: 1, attackSpeed: 1 + MOMENTUM_MAX,
      whirlwindTicks: 1, cleave: 1, deflectReturn: 1 + PARRY_RETURN_BONUS, healPerSwing: BLOODLUST_HEAL_SHARE });
    const sorcery = masteryTechniqueBound(at("sorcery", 50), true);
    expect(sorcery).toMatchObject({ crits: true, meteorFalls: 1 });
    expect(sorcery.guard).toBeCloseTo(1 / (1 - MANA_SHIELD_REDUCTION));
  });

  it("counts Rain of Arrows, Blade Storm, Cleave and Meteor Shower as whole extra hits in the reach", () => {
    expect(bowSkillReachMultiplier({ arrowStorm: 10 }, 1) - bowSkillReachMultiplier({ arrowStorm: 10 })).toBeCloseTo(.1 * ARROW_STORM_ARROWS);
    expect(swordSkillReachMultiplier({ whirlwind: 10 }, 1, 1) - swordSkillReachMultiplier({ whirlwind: 10 }))
      .toBeCloseTo(1 + .1 * WHIRLWIND_MAX_TARGETS);
    expect(swordSkillReachMultiplier({ whirlwind: 10 }, 1)).toBeCloseTo(1 + .1 * (WHIRLWIND_TICKS + 1) * WHIRLWIND_MAX_TARGETS);
    expect(staffSkillReachMultiplier({ meteor: 10 }, 1) - staffSkillReachMultiplier({ meteor: 10 })).toBeCloseTo(.1 * METEOR_MAX_TARGETS * 2);
  });
});

describe("mastery techniques in duels", () => {
  const plainCrit = { chance: 0, multiplier: 2 };
  const fold = (mastery: MasteryInPlay, extra: Partial<Parameters<typeof duelMasteryFold>[0]> = {}) => duelMasteryFold({
    mastery, crit: plainCrit, damage: 100, attackInterval: 1, maxHp: 1_000, deflect: 0,
    opponent: { damage: 100, attackInterval: 1, ranged: true }, ...extra });

  it("folds the extra wave, tick and fall into the proc chance, and Overcharge into Chain's, capped at 100%", () => {
    const fields = { challengerArrowStorm: 10, challengerWhirlwind: 9, challengerMeteor: 60, challengerChain: 10, opponentArrowStorm: 10,
      opponentRicochet: 10 };
    expect(duelSkillsWithTechniques(fields, at("archery", 50), at("archery", 49))).toEqual({ ...fields, challengerArrowStorm: 20 });
    expect(duelSkillsWithTechniques(fields, at("swordplay", 50), at("archery", 0)).challengerWhirlwind).toBeCloseTo(12);
    const sorcery = duelSkillsWithTechniques(fields, at("sorcery", 50), at("sorcery", 0));
    expect(sorcery.challengerMeteor).toBe(100);
    expect(sorcery.challengerChain).toBeCloseTo(11.5);
    expect(duelSkillsWithTechniques(fields, at("sorcery", 0), at("sorcery", 0))).toEqual(fields);
  });

  it("plays Steady Aim and Focus as one crit in six, and Hunter's Mark and Hex as the share of hits a recent crit marks", () => {
    expect(fold(at("archery", 9)).damage).toBe(1);
    // No crit chance of their own: one hit in six is double, so a hit is worth 7/6.
    expect(fold(at("archery", 10)).damage).toBeCloseTo(7 / 6);
    expect(fold(at("sorcery", 10), { crit: { chance: .5, multiplier: 2 } }).damage).toBeCloseTo((1 + (1 / 6 + 5 / 6 * .5)) / 1.5);
    // One shot a second: the four before a hit hold the forced crit four times in six.
    expect(fold(at("archery", 30)).damage).toBeCloseTo(7 / 6 * (1 + MARK_DAMAGE_BONUS * 4 / 6));
    // Six or more shots inside the mark always include a forced crit.
    expect(fold(at("archery", 30), { attackInterval: .5 }).damage).toBeCloseTo(7 / 6 * (1 + MARK_DAMAGE_BONUS));
  });

  it("gives Volley, Cleave and Tailwind no duel meaning", () => {
    expect(fold(at("archery", 20))).toEqual(fold(at("archery", 19)));
    expect(fold(at("archery", 40))).toEqual(fold(at("archery", 39)));
    expect(fold(at("swordplay", 10))).toEqual(fold(at("swordplay", 9)));
  });

  it("plays Parry's bigger return as damage, only against a ranged opponent", () => {
    // 10% Deflect returns 20% more of a 100 hit, once a second against a once-a-second 100 swing.
    expect(fold(at("swordplay", 20), { deflect: 10 }).damage).toBeCloseTo(1 + .1 * .2 * 100 / 100);
    expect(fold(at("swordplay", 20), { deflect: 10, opponent: { damage: 100, attackInterval: 1, ranged: false } }).damage).toBe(1);
  });

  it("plays Bloodlust as regen, Momentum as full speed, Mana Shield as less damage for the same knockout", () => {
    expect(fold(at("swordplay", 30)).regen).toBeCloseTo(BLOODLUST_HEAL_SHARE * 1_000);
    const fast = fold(at("swordplay", 40));
    expect(fast.attackInterval).toBeCloseTo(1 / (1 + MOMENTUM_MAX));
    expect(fast.regen).toBeCloseTo(BLOODLUST_HEAL_SHARE * 1_000 * (1 + MOMENTUM_MAX));
    expect(fold(at("sorcery", 40)).damageTaken).toBeCloseTo(1 / (.5 + .5 / .95));
    expect(fold(at("sorcery", 39)).damageTaken).toBe(1);
  });
});
