import { CARD_EFFECT_DEFAULTS } from "./card-effects";
import { PRISM_MAX_TARGETS } from "./card-bounds";
import { type CardDefinition, type CardEffect, type CardEffectId, type CardSlot } from "./cards";
import { MAP_DISPLAY_NAMES } from "./rules";
import type { RewardType } from "./enemy-definitions";

export const STAT_NAMES: Readonly<Record<RewardType, string>> = {
  damage: "Damage", health: "Max Health", speed: "Attack Speed", armor: "Armor", regen: "Regen", crit: "Crit Damage",
};
export const CARD_SLOT_NAMES: Readonly<Record<CardSlot, string>> = { HAND: "Weapon", HEAD: "Helmet", CHEST: "Armor" };

const number = (value: number) => `${Math.round(value * 100) / 100}`;
const percent = (share: number) => `${Math.round(share * 100)}%`;
const signed = (value: number) => (value < 0 ? `-${number(-value)}` : `+${number(value)}`);
/** The Cards tab's zones that are not a map: the Warden cards and the tree cards. */
const CARD_ZONE_NAMES: Readonly<Record<string, string>> = { endless: "Endless", timberwood: "Timberwood" };
export const mapName = (mapId: string) =>
  (MAP_DISPLAY_NAMES as Record<string, string>)[mapId]?.replace(/ - \d+$/, "") ?? CARD_ZONE_NAMES[mapId] ?? mapId;

/** What one effect of a card does, as players read it. */
export function cardEffectText(effect: CardEffect): string {
  const v = effect.value, abs = number(Math.abs(v));
  const lines: Partial<Record<CardEffectId, () => string>> = {
    atk: () => `Damage ${signed(v)}%`,
    critChance: () => `Crit Chance ${signed(v)}%`,
    critDamage: () => `Crit Damage and its cap ${signed(v)}%`,
    doubleStrike: () => `${abs}% chance a hit lands twice`,
    splitShot: () => `${abs}% chance to also hit a second nearby enemy`,
    bossSlayer: () => `Damage to bosses ${signed(v)}%`,
    eliteSlayer: () => `Damage to elites ${signed(v)}%`,
    raceSlayer: () => `Damage to ${mapName(effect.mapId ?? "")} enemies ${signed(v)}%`,
    rangedSlayer: () => `Damage to ranged enemies ${signed(v)}%`,
    execute: () => `Damage to enemies under ${percent(CARD_EFFECT_DEFAULTS.execute.below)} health ${signed(v)}%`,
    opener: () => `Damage to enemies at full health ${signed(v)}%`,
    berserk: () => `Damage ${signed(v)}% while you are under ${percent(CARD_EFFECT_DEFAULTS.berserk.below)} health`,
    steady: () => `Damage ${signed(v)}% while you stand still`,
    momentum: () => `Each kill: damage ${signed(v)}% for ${CARD_EFFECT_DEFAULTS.momentum.seconds}s, stacks ${CARD_EFFECT_DEFAULTS.momentum.stacks} times`,
    burn: () => `${v >= 100 ? "Every hit burns" : `${abs}% chance to burn`}: ${percent(effect.share ?? CARD_EFFECT_DEFAULTS.burn.share)} of the hit over ${effect.seconds ?? CARD_EFFECT_DEFAULTS.burn.seconds}s`,
    poison: () => `${abs}% chance to poison: ${percent(CARD_EFFECT_DEFAULTS.poison.share)} of the hit over ${CARD_EFFECT_DEFAULTS.poison.seconds}s, and the enemy hits ${percent(CARD_EFFECT_DEFAULTS.poison.weaken)} softer`,
    chill: () => `${abs}% chance to slow an enemy ${percent(CARD_EFFECT_DEFAULTS.chill.slow)} for ${CARD_EFFECT_DEFAULTS.chill.seconds}s`,
    stun: () => `${abs}% chance to stun an enemy for ${effect.seconds ?? CARD_EFFECT_DEFAULTS.stun.seconds}s (not bosses)`,
    weaken: () => `${abs}% chance: the enemy deals ${percent(CARD_EFFECT_DEFAULTS.weaken.weaken)} less damage for ${CARD_EFFECT_DEFAULTS.weaken.seconds}s`,
    knockback: () => `${abs}% chance to knock an enemy back`,
    splash: () => effect.chance !== undefined
      ? `${number(effect.chance)}% chance a hit also deals ${abs}% of its damage to every enemy near the target`
      : `Every hit also deals ${abs}% of its damage to enemies near the target`,
    chainLightning: () => `${abs}% chance to arc to ${effect.targets ?? CARD_EFFECT_DEFAULTS.chainLightning.targets} more enemies for ${percent(effect.share ?? CARD_EFFECT_DEFAULTS.chainLightning.share)}`,
    lifesteal: () => `Heal ${abs}% of the damage you deal`,
    quickDraw: () => `Attack speed cap ${signed(v)}/s`,
    arrowStorm: () => `With a bow: Arrow Storm chance ${signed(v)}%`,
    ricochet: () => `With a bow: Ricochet chance ${signed(v)}%`,
    piercing: () => `With a bow: Piercing Shot chance ${signed(v)}%`,
    iaido: () => "Your first hit on each enemy is always a critical",
    reap: () => `Regular enemies under ${abs}% health die at once`,
    maxHealth: () => `Max Health ${signed(v)}%`,
    armor: () => `Armor ${signed(v)}%`,
    regen: () => `Regen ${signed(v)}%`,
    reflect: () => `${abs}% chance to send a hit back`,
    secondWind: () => `Heal ${abs}% of max health on each kill`,
    dodge: () => `${abs}% chance to dodge a hit`,
    rangedGuard: () => `Damage from ranged enemies -${abs}%`,
    meleeGuard: () => `Damage from melee enemies -${abs}%`,
    bossGuard: () => `Damage from bosses -${abs}%`,
    eliteGuard: () => `Damage from elites -${abs}%`,
    raceGuard: () => `Damage from ${mapName(effect.mapId ?? "")} enemies -${abs}%`,
    shield: () => `A shield of ${abs}% max health that takes all of the hit that breaks it, back ${effect.seconds ?? CARD_EFFECT_DEFAULTS.shield.seconds}s after the last hit`,
    panicHeal: () => `Hit under ${percent(CARD_EFFECT_DEFAULTS.panicHeal.below)} health: ${abs}% chance to heal ${percent(CARD_EFFECT_DEFAULTS.panicHeal.heal)}`,
    lastStand: () => `Once per map visit, a killing blow leaves you at ${abs}% health`,
    web: () => `Enemies that hit you are slowed ${abs}% for ${effect.seconds ?? CARD_EFFECT_DEFAULTS.web.seconds}s`,
    prism: () => `A reflected hit also strikes up to ${PRISM_MAX_TARGETS} enemies near the attacker, each once a second at most`,
    fleetFoot: () => `Move Speed ${signed(v)}%`,
    longShot: () => `Attack Range ${signed(v)}`,
    statGain: () => `${STAT_NAMES[effect.stat ?? "damage"]} from kills ${signed(v)}%`,
    allStatGain: () => `All stats from kills ${signed(v)}%`,
    cardHunter: () => `Card drop chance ${signed(v)}%`,
    treasure: () => `Gold drop chance ${signed(v)}%`,
    respawn: () => `Enemies respawn ${abs}% faster`,
    miningSpeed: () => `Mining speed ${signed(v)}%`,
    oreFind: () => `${abs}% chance for an extra ore`,
    starshardFind: () => `${signed(v)}% chance of a second Starshard`,
    woodcuttingSpeed: () => `Chop speed ${signed(v)}%`,
    logFind: () => `${abs}% chance for an extra log`,
    onward: () => "Beat a boss that opens the next map: you go straight there",
  };
  return lines[effect.effect]?.() ?? effect.effect;
}

/** "Needle Card". */
export const cardName = (card: CardDefinition) => `${card.enemy} Card`;


const killWord = (card: CardDefinition, many: boolean) =>
  card.tree ? `tree${many ? "s" : ""}` : `${card.rarity === "boss" ? "boss " : ""}kill${many ? "s" : ""}`;

/** "Endless 11–20", "Endless 51+": the maps whose Wardens drop a card. */
const endlessBand = ({ from, to }: { from: number; to?: number }) => `Endless ${from}${to === undefined ? "+" : `–${to}`}`;
/** Where a card drops: its map, or for a Warden card its band, "Endless 11–20". */
const cardWhere = (card: CardDefinition) => card.endless ? endlessBand(card.endless) : mapName(card.mapId);

/** "Elite · Tutorial Forest". */
export const cardOrigin = (card: CardDefinition) =>
  `${card.rarity === "boss" ? "Boss" : card.rarity === "elite" ? "Elite" : "Regular"} · ${cardWhere(card)}`;

/**
 * Where a card drops and one kill's chance at it: "Tutorial Forest · 1 in 877 kills" (boss cards per boss kill,
 * Warden cards by their band of Endless, tree cards per tree felled).
 */
export function cardOddsText(card: CardDefinition, chance: number) {
  const where = cardWhere(card);
  if (!(chance > 0)) return `${where} · No drop`;
  if (chance >= 1) return `${where} · Every ${killWord(card, false)}`;
  return `${where} · 1 in ${Math.max(1, Math.round(1 / chance)).toLocaleString("en-US")} ${killWord(card, true)}`;
}

/** "Sure by 2,000 kills": a full card meter guarantees the card. */
export const cardSureText = (card: CardDefinition, kills: number) => `Sure by ${kills.toLocaleString("en-US")} ${killWord(card, kills !== 1)}`;
