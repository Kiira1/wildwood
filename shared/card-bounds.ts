import { CARD_EFFECT_DEFAULTS, CARD_GUARD_CAP, cardChance, cardValue, type CardTotals } from "./card-effects";
import type { BowSkillRoll } from "./bow-skills";

/** How far a splash reaches around the target, and how many enemies the kill bound lets it find. */
export const CARD_SPLASH_RADIUS = 80;
export const CARD_SPLASH_MAX_TARGETS = 6;
/** How far Chain Lightning arcs from one enemy to the next. */
export const CARD_CHAIN_RANGE = 170;

/** A bow's roll with the worn cards' Arrow Storm, Ricochet and Piercing Shot added, as percentages like the roll. */
export function bowSkillsWithCards(roll: Partial<BowSkillRoll> | null | undefined, totals: CardTotals): BowSkillRoll {
  const add = (skill: keyof BowSkillRoll, effect: "arrowStorm" | "ricochet" | "piercing") =>
    Math.max(0, Number(roll?.[skill] ?? 0) || 0) + Math.max(0, cardValue(totals, effect));
  return { arrowStorm: add("arrowStorm", "arrowStorm"), ricochet: add("ricochet", "ricochet"), piercingShot: add("piercingShot", "piercing") };
}

/**
 * What worn cards add to the most a player could kill in a report (boss-combat.ts): damage per hit with every
 * conditional bonus at once and damage over time in full, and enemies reached per hit. Generous on purpose, so
 * the bound only errs towards paying. Map cards count at their best map's value.
 */
export function cardOffenseBound(totals: CardTotals) {
  const percent = (effect: Parameters<typeof cardValue>[1]) => Math.max(0, cardValue(totals, effect)) / 100;
  const race = Math.max(0, ...Object.values(totals.raceSlayer)) / 100;
  const conditional = 1 + percent("eliteSlayer") + percent("rangedSlayer") + race + percent("execute") + percent("opener")
    + percent("berserk") + percent("steady") + percent("momentum") * CARD_EFFECT_DEFAULTS.momentum.stacks;
  let overTime = 1, splash = percent("splash") * CARD_SPLASH_MAX_TARGETS, chain = 0;
  for (const proc of totals.procs) {
    const chance = proc.chance / 100;
    if (proc.effect === "burn") overTime += chance * (proc.share ?? CARD_EFFECT_DEFAULTS.burn.share);
    if (proc.effect === "poison") overTime += chance * CARD_EFFECT_DEFAULTS.poison.share;
    if (proc.effect === "splash") splash += chance * (proc.share ?? 0) * CARD_SPLASH_MAX_TARGETS;
    if (proc.effect === "chainLightning") {
      chain += chance * (proc.targets ?? CARD_EFFECT_DEFAULTS.chainLightning.targets) * (proc.share ?? CARD_EFFECT_DEFAULTS.chainLightning.share);
    }
  }
  // Reap finishes a regular enemy at its threshold: its last share of health takes no damage.
  const reap = 1 / (1 - Math.min(.9, percent("reap")));
  return {
    damage: conditional * (1 + cardChance(totals, "doubleStrike") / 100) * overTime * reap,
    reach: 1 + cardChance(totals, "splitShot") / 100 + splash + chain,
    /** The first hit on each enemy always crits, so crits are possible with no crit chance at all. */
    crits: cardValue(totals, "iaido") > 0,
    reflect: cardChance(totals, "reflect") / 100,
    /** A reflected hit also strikes the enemies near its attacker. */
    prism: cardValue(totals, "prism") > 0,
  };
}

/**
 * Health a second the worn cards give back or soak, at most, for the Reflect bound: a shield refilled as often
 * as it can be, lifesteal on the weapon's damage, Panic Heal on every hit a second can land, and Last Stand once
 * a life.
 */
export function cardSustainBound(totals: CardTotals, maxHp: number, weaponDps: number, hitsPerSecond: number, lifeSeconds: number) {
  const share = (effect: Parameters<typeof cardValue>[1]) => Math.max(0, cardValue(totals, effect)) / 100;
  return share("shield") * maxHp / Math.max(1, totals.timing.shield)
    + share("lifesteal") * Math.max(0, weaponDps)
    + cardChance(totals, "panicHeal") / 100 * CARD_EFFECT_DEFAULTS.panicHeal.heal * maxHp * hitsPerSecond
    + share("lastStand") * maxHp / Math.max(1, lifeSeconds);
}

/** How much bigger a hit was before the worn guards than what they let through, for whichever attacker they cover most. */
export function cardGuardFactor(totals: CardTotals) {
  const guard = Math.max(cardValue(totals, "rangedGuard"), cardValue(totals, "meleeGuard")) + cardValue(totals, "bossGuard")
    + cardValue(totals, "eliteGuard") + Math.max(0, ...Object.values(totals.raceGuard));
  return 1 / (1 - Math.min(CARD_GUARD_CAP, Math.max(0, guard)) / 100);
}
