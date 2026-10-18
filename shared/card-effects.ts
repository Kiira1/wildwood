import { cardDefinition, type CardEffect, type CardEffectId } from "./cards";
import type { RewardType } from "./enemy-definitions";

/** The active cards (active-cards.ts), added up for server, client and duels, with caps: chances 50%, dodge 30%, guards 60%. */
export const CARD_CHANCE_CAP = 50;
export const CARD_DODGE_CAP = 30;
export const CARD_GUARD_CAP = 60;

/** Defaults for effects whose card gives no parameters. */
export const CARD_EFFECT_DEFAULTS = Object.freeze({
  burn: { share: .5, seconds: 3 },
  poison: { share: .4, seconds: 4, weaken: .15 },
  chill: { slow: .4, seconds: 2 },
  stun: { seconds: 1 },
  weaken: { weaken: .3, seconds: 3 },
  chainLightning: { targets: 2, share: .5 },
  shield: { seconds: 8 },
  web: { seconds: 2 },
  momentum: { seconds: 4, stacks: 5 },
  execute: { below: .3 },
  berserk: { below: .5 },
  panicHeal: { below: .3, heal: .2 },
});

const PROC_EFFECTS: ReadonlySet<CardEffectId> = new Set(["burn", "poison", "chill", "stun", "weaken", "knockback", "chainLightning"]);

/** An effect that rolls on its own. Same effect and strength add chances; a boss card's version rolls apart. */
export type CardProc = {
  effect: CardEffectId;
  /** Percent, after the cap. A card that does it on every hit (100) is no chance, so the cap leaves it be. */
  chance: number;
  always?: boolean;
  share?: number;
  seconds?: number;
  targets?: number;
};

export type CardTotals = {
  sum: Partial<Record<CardEffectId, number>>;
  /** By map id. */
  raceSlayer: Readonly<Record<string, number>>;
  raceGuard: Readonly<Record<string, number>>;
  statGain: Partial<Record<RewardType, number>>;
  procs: readonly CardProc[];
  /** Seconds: the quickest shield refill and the longest web among the active cards. */
  timing: { shield: number; web: number };
};

const DEFAULT_TIMING = Object.freeze({ shield: CARD_EFFECT_DEFAULTS.shield.seconds, web: CARD_EFFECT_DEFAULTS.web.seconds });
export const NO_CARDS: CardTotals = Object.freeze({ sum: {}, raceSlayer: {}, raceGuard: {}, statGain: {}, procs: [], timing: DEFAULT_TIMING });

const add = <K extends string>(record: Partial<Record<K, number>>, key: K, value: number) => { record[key] = (record[key] ?? 0) + value; };

/** Unknown card ids are skipped. */
export function cardTotals(cardIds: readonly string[]): CardTotals {
  if (!cardIds.length) return NO_CARDS;
  const sum: Partial<Record<CardEffectId, number>> = {}, raceSlayer: Record<string, number> = {}, raceGuard: Record<string, number> = {};
  const statGain: Partial<Record<RewardType, number>> = {};
  const procs = new Map<string, CardProc>();
  let shield: number | undefined, web: number | undefined;
  const addProc = (proc: CardProc) => {
    const key = `${proc.effect}:${proc.share ?? ""}:${proc.seconds ?? ""}:${proc.targets ?? ""}`;
    const current = procs.get(key);
    procs.set(key, current ? { ...current, chance: current.chance + proc.chance, ...(current.always || proc.always ? { always: true } : {}) } : proc);
  };
  for (const cardId of cardIds) {
    for (const effect of cardDefinition(cardId)?.effects ?? []) addEffect(effect);
  }
  function addEffect(effect: CardEffect) {
    if (effect.effect === "raceSlayer" && effect.mapId) return add(raceSlayer, effect.mapId, effect.value);
    if (effect.effect === "raceGuard" && effect.mapId) return add(raceGuard, effect.mapId, effect.value);
    if (effect.effect === "statGain" && effect.stat) return add(statGain, effect.stat, effect.value);
    // A splash with a chance rolls on its own; an always-on one adds up.
    if (effect.effect === "splash" && effect.chance !== undefined) return addProc({ effect: "splash", chance: effect.chance, share: effect.value / 100 });
    if (PROC_EFFECTS.has(effect.effect)) {
      return addProc({ effect: effect.effect, chance: effect.value, ...(effect.value >= 100 ? { always: true } : {}),
        ...(effect.share !== undefined ? { share: effect.share } : {}),
        ...(effect.seconds !== undefined ? { seconds: effect.seconds } : {}),
        ...(effect.targets !== undefined ? { targets: effect.targets } : {}) });
    }
    const seconds = effect.seconds ?? (effect.effect === "shield" ? DEFAULT_TIMING.shield : DEFAULT_TIMING.web);
    if (effect.effect === "shield") shield = Math.min(shield ?? seconds, seconds);
    if (effect.effect === "web") web = Math.max(web ?? seconds, seconds);
    add(sum, effect.effect, effect.value);
  }
  return { sum, raceSlayer, raceGuard, statGain,
    procs: [...procs.values()].map(proc => ({ ...proc, chance: proc.always ? 100 : Math.min(CARD_CHANCE_CAP, proc.chance) })),
    timing: { shield: shield ?? DEFAULT_TIMING.shield, web: web ?? DEFAULT_TIMING.web } };
}

/** A summed chance after its cap. */
export function cardChance(totals: CardTotals, effect: CardEffectId) {
  const value = Math.max(0, totals.sum[effect] ?? 0);
  return Math.min(effect === "dodge" ? CARD_DODGE_CAP : CARD_CHANCE_CAP, value);
}

/** Negative is a card's cost. */
export function cardValue(totals: CardTotals, effect: CardEffectId) {
  return totals.sum[effect] ?? 0;
}

/** Incoming hit multiplier from the guards that apply to the attacker, at most 60% off. */
export function cardDamageTakenMultiplier(totals: CardTotals, attacker: { boss?: boolean; elite?: boolean; ranged?: boolean; mapId?: string }) {
  let guard = attacker.ranged ? cardValue(totals, "rangedGuard") : cardValue(totals, "meleeGuard");
  if (attacker.boss) guard += cardValue(totals, "bossGuard");
  if (attacker.elite) guard += cardValue(totals, "eliteGuard");
  if (attacker.mapId) guard += totals.raceGuard[attacker.mapId] ?? 0;
  return 1 - Math.min(CARD_GUARD_CAP, Math.max(0, guard)) / 100;
}

/** Outgoing hit multiplier from the slayers that apply to the target. */
export function cardDamageDealtMultiplier(totals: CardTotals, target: { boss?: boolean; elite?: boolean; ranged?: boolean; mapId?: string }) {
  let bonus = 0;
  if (target.boss) bonus += cardValue(totals, "bossSlayer");
  if (target.elite) bonus += cardValue(totals, "eliteSlayer");
  if (target.ranged) bonus += cardValue(totals, "rangedSlayer");
  if (target.mapId) bonus += totals.raceSlayer[target.mapId] ?? 0;
  return 1 + Math.max(0, bonus) / 100;
}

/**
 * What the active cards do to a player's stats: multipliers on damage, max health, armor and regen, crit chance
 * and crit damage as fractions, and the attack speed cap, move speed and range they add.
 */
export function cardStatFactors(totals: CardTotals) {
  const factor = (effect: CardEffectId) => Math.max(0, 1 + cardValue(totals, effect) / 100);
  return {
    damage: factor("atk"), maxHp: factor("maxHealth"), armor: factor("armor"), regen: factor("regen"),
    critChance: cardChance(totals, "critChance") / 100,
    critDamage: Math.max(0, cardValue(totals, "critDamage")) / 100,
    attackCapRaise: Math.max(0, cardValue(totals, "quickDraw")),
    moveSpeed: Math.max(0, cardValue(totals, "fleetFoot")) / 100,
    range: Math.max(0, cardValue(totals, "longShot")),
    // What they do outside a fight, as fractions: faster mining, an extra ore's chance, Starshard, card and gear
    // drop chances, and faster respawns.
    miningSpeed: Math.max(0, cardValue(totals, "miningSpeed")) / 100,
    oreFind: cardChance(totals, "oreFind") / 100,
    starshardFind: Math.max(0, cardValue(totals, "starshardFind")) / 100,
    cardHunter: Math.max(0, cardValue(totals, "cardHunter")) / 100,
    treasure: Math.max(0, cardValue(totals, "treasure")) / 100,
    respawn: Math.max(0, cardValue(totals, "respawn")) / 100,
  };
}

/** What Bounty cards multiply a kill's stat reward of this type by: their own stat's and all stats', added. */
export function cardStatGainFactor(totals: CardTotals, type: string) {
  return 1 + Math.max(0, (totals.statGain[type as RewardType] ?? 0) + cardValue(totals, "allStatGain")) / 100;
}

/** A respawn sped up by the active cards: they add a share to how often enemies come back. */
export const respawnSecondsWithCards = (seconds: number, respawn: number) => seconds / (1 + Math.max(0, respawn));
export type CardStatFactors = ReturnType<typeof cardStatFactors>;
