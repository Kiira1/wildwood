import { WHIRLWIND_TICKS } from "./sword-skills";
import { SCHOOL_DETAILS, WEAPON_SCHOOLS, masteryDamageTaken, type MasteryInPlay, type WeaponSchool } from "./weapon-mastery";

/**
 * Weapon Mastery techniques: what each one does in a fight. Each is learned at its level in SCHOOL_DETAILS and works
 * only while its school's weapon is in the right hand. None moves the player.
 */
export type MasteryTechniqueId =
  | "steadyAim" | "volley" | "huntersMark" | "tailwind" | "rainOfArrows"
  | "cleave" | "parry" | "bloodlust" | "momentum" | "bladeStorm"
  | "focus" | "overcharge" | "hex" | "manaShield" | "meteorShower";

// ---- Every technique number is in this block. ----
/** Steady Aim (arrows) and Focus (bolts): every this many shots, one is a critical hit. */
export const STEADY_AIM_EVERY = 6;
/** Volley: a Split Shot arrow's extra damage. */
export const VOLLEY_SPLIT_SHOT_BONUS = .15;
/** Hunter's Mark (arrows) and Hex (bolts): a critical hit marks its target, which takes this much more for MARK_SECONDS. */
export const MARK_DAMAGE_BONUS = .08;
export const MARK_SECONDS = 4;
/** Tailwind: move speed for TAILWIND_SECONDS after a kill. */
export const TAILWIND_SPEED_BONUS = .06;
export const TAILWIND_SECONDS = 3;
/** Rain of Arrows: Arrow Storm's extra waves, each as many arrows as the first. */
export const RAIN_OF_ARROWS_EXTRA_WAVES = 1;
/** Cleave: a swing's extra enemies and the share of the swing each takes. */
export const CLEAVE_TARGETS = 1;
export const CLEAVE_DAMAGE_SHARE = .3;
/** Parry: Deflect's return, this much bigger. */
export const PARRY_RETURN_BONUS = .2;
/** Bloodlust: max health healed by each swing that lands. */
export const BLOODLUST_HEAL_SHARE = .005;
/** Momentum: attack speed for each swing in a row that lands, up to MOMENTUM_MAX; a miss starts over. */
export const MOMENTUM_PER_HIT = .02;
export const MOMENTUM_MAX = .1;
/** Blade Storm: Whirlwind's extra ticks. */
export const BLADE_STORM_EXTRA_TICKS = 1;
/** Overcharge: Chain Lightning jumps' extra damage. */
export const OVERCHARGE_CHAIN_BONUS = .15;
/** Mana Shield: less damage taken while health is above MANA_SHIELD_ABOVE of max. */
export const MANA_SHIELD_REDUCTION = .05;
export const MANA_SHIELD_ABOVE = .5;
/** Meteor Shower: Meteor's extra falls, each this long after the one before. */
export const METEOR_SHOWER_EXTRA_FALLS = 1;
export const METEOR_SHOWER_GAP_SECONDS = .3;
// ---- End of the technique numbers. ----

const TECHNIQUE_SCHOOL = new Map<string, { school: WeaponSchool; level: number }>(WEAPON_SCHOOLS.flatMap(school =>
  SCHOOL_DETAILS[school].techniques.map(technique => [technique.id, { school, level: technique.level }] as const)));

/** Whether a technique is learned and its school's weapon is the one in hand. */
export function hasTechnique(mastery: MasteryInPlay | null | undefined, id: MasteryTechniqueId) {
  const learned = TECHNIQUE_SCHOOL.get(id);
  return Boolean(mastery && learned && mastery.school === learned.school && mastery.level >= learned.level);
}

/** Every how many arrows or bolts one is a forced critical hit: 0 without Steady Aim or Focus. */
export const masteryCritEvery = (mastery: MasteryInPlay | null | undefined) =>
  hasTechnique(mastery, "steadyAim") || hasTechnique(mastery, "focus") ? STEADY_AIM_EVERY : 0;
/** Whether criticals mark their target (Hunter's Mark, Hex). */
export const masteryMarks = (mastery: MasteryInPlay | null | undefined) => hasTechnique(mastery, "huntersMark") || hasTechnique(mastery, "hex");

/** The share of a hit that lands: Swordplay's Guard, and Mana Shield while above half health. */
export function masteryDamageTakenAt(mastery: MasteryInPlay | null | undefined, hp: number, maxHp: number) {
  const shield = hasTechnique(mastery, "manaShield") && hp > maxHp * MANA_SHIELD_ABOVE ? 1 - MANA_SHIELD_REDUCTION : 1;
  return masteryDamageTaken(mastery) * shield;
}

/**
 * What the techniques add to the server's kill bound, every one at its most: a Split Shot arrow at Volley's damage,
 * every hit marked, Momentum always full, Cleave's hit counted as a whole swing, every crit forced.
 */
export function masteryTechniqueBound(mastery: MasteryInPlay | null | undefined, splitShot: boolean) {
  const has = (id: MasteryTechniqueId) => hasTechnique(mastery, id);
  return {
    crits: masteryCritEvery(mastery) > 0,
    damage: (masteryMarks(mastery) ? 1 + MARK_DAMAGE_BONUS : 1) * (splitShot && has("volley") ? 1 + VOLLEY_SPLIT_SHOT_BONUS : 1),
    attackSpeed: has("momentum") ? 1 + MOMENTUM_MAX : 1,
    stormWaves: has("rainOfArrows") ? RAIN_OF_ARROWS_EXTRA_WAVES : 0,
    whirlwindTicks: has("bladeStorm") ? BLADE_STORM_EXTRA_TICKS : 0,
    meteorFalls: has("meteorShower") ? METEOR_SHOWER_EXTRA_FALLS : 0,
    cleave: has("cleave") ? CLEAVE_TARGETS : 0,
    deflectReturn: has("parry") ? 1 + PARRY_RETURN_BONUS : 1,
    healPerSwing: has("bloodlust") ? BLOODLUST_HEAL_SHARE : 0,
    // The most a hit is lowered by, so a reflected hit can be that much bigger than what was lost.
    guard: has("manaShield") ? 1 / (1 - MANA_SHIELD_REDUCTION) : 1,
  };
}

/**
 * Duel skill fields (challengerArrowStorm, opponentMeteor ...) with each side's techniques folded into the chance:
 * an extra wave, tick or fall is that many more of the same proc, and Overcharge more Chain. Each fold keeps the
 * expected damage exact; capped at 100%.
 */
export function duelSkillsWithTechniques<T extends Record<string, number>>(fields: T, challenger: MasteryInPlay, opponent: MasteryInPlay): T {
  const scale = (mastery: MasteryInPlay, skill: string) => {
    const bound = masteryTechniqueBound(mastery, false);
    if (skill === "ArrowStorm") return 1 + bound.stormWaves;
    if (skill === "Whirlwind") return 1 + bound.whirlwindTicks / WHIRLWIND_TICKS;
    if (skill === "Meteor") return 1 + bound.meteorFalls;
    if (skill === "Chain") return hasTechnique(mastery, "overcharge") ? 1 + OVERCHARGE_CHAIN_BONUS : 1;
    return 1;
  };
  return Object.fromEntries(Object.entries(fields).map(([field, percent]) => {
    const side = field.startsWith("challenger") ? challenger : field.startsWith("opponent") ? opponent : null;
    const skill = field.replace(/^(challenger|opponent)/, "");
    return [field, side ? Math.min(100, percent * scale(side, skill)) : percent];
  })) as T;
}

/**
 * One duellist's techniques, folded into what a duel stores (damage, attack interval, regen) the way cards are:
 * a deterministic fight plays expected values. `crit` is their duel crit; `opponent` what they face.
 * Volley, Cleave and Tailwind mean nothing in a duel: no Split Shot, one opponent, no kills.
 */
export function duelMasteryFold(input: {
  mastery: MasteryInPlay; crit: { chance: number; multiplier: number }; damage: number; attackInterval: number; maxHp: number;
  /** Their own Deflect chance in percent, Skill Proficiency included. */
  deflect: number;
  opponent: { damage: number; attackInterval: number; ranged: boolean };
}) {
  const { mastery, damage, maxHp, opponent } = input;
  const chance = Math.max(0, Math.min(1, input.crit.chance)), extra = Math.max(0, input.crit.multiplier - 1);
  const every = masteryCritEvery(mastery);
  // Steady Aim and Focus: one shot in six crits, the other five roll as before.
  const forcedChance = every ? 1 / every + (1 - 1 / every) * chance : chance;
  let factor = (1 + forcedChance * extra) / (1 + chance * extra);
  const attackInterval = input.attackInterval / (hasTechnique(mastery, "momentum") ? 1 + MOMENTUM_MAX : 1);
  if (masteryMarks(mastery)) {
    // A hit is marked when any shot in the MARK_SECONDS before it crit.
    const before = Math.max(0, Math.floor(MARK_SECONDS / Math.max(1e-6, attackInterval)));
    const noForced = every ? Math.max(0, every - before) / every : 1;
    factor *= 1 + MARK_DAMAGE_BONUS * (1 - noForced * (1 - chance) ** before);
  }
  // Parry: Deflect's extra return, as damage spread over their own attacks. Only a ranged attack can be deflected.
  if (hasTechnique(mastery, "parry") && opponent.ranged && damage > 0) {
    const returned = Math.max(0, Math.min(100, input.deflect)) / 100 * PARRY_RETURN_BONUS * Math.min(opponent.damage, maxHp);
    factor *= 1 + returned * (attackInterval / Math.max(1e-6, opponent.attackInterval)) / damage;
  }
  return {
    damage: factor,
    attackInterval,
    // Bloodlust: every duel swing lands, so its heal is a steady regen.
    regen: hasTechnique(mastery, "bloodlust") ? BLOODLUST_HEAL_SHARE * maxHp / attackInterval : 0,
    // Mana Shield: the same knockout takes this much less damage per hit overall (the top half of health takes less).
    damageTaken: hasTechnique(mastery, "manaShield")
      ? 1 / (MANA_SHIELD_ABOVE + (1 - MANA_SHIELD_ABOVE) / (1 - MANA_SHIELD_REDUCTION)) : 1,
  };
}
