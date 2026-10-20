/**
 * Another player's bonuses in play, worked out from the rows the server keeps public, the way the server
 * reads its own: research and soul (bonus-toggles.ts researchInPlay, soul-dimension.ts soulStatsFor), perks
 * (prestige.ts prestigePerkRanks), card slots (active-cards.ts activeCardIdsFor) and the attack speed cap
 * (prestige.ts attackCapInPlay). Pure, so profiles and remote combat read the same thing.
 */
import { BASE_CARD_SLOTS, NO_ACTIVE_CARDS, activeCardSlots, activeCardsInPlay, type ActiveCards } from "./active-cards";
import { prestigeBonusesOff, type AggroChallenge } from "./aggro-challenge";
import { perksInPlayFor, reflectRewardsOn, researchInPlayFor, soulInPlayFor } from "./bonus-toggles";
import { cardStatFactors, cardTotals } from "./card-effects";
import type { PrestigeChallenge } from "./prestige-challenge";
import { PRESTIGE_PERK_IDS, playerAttackCap, type PrestigePerkRanks } from "./prestige-perks";
import { cleanSoulStats, type SoulStats } from "./soul-dimension";
import { weaponSchool, type MasteryInPlay, type WeaponSchool } from "./weapon-mastery";

export type PublicStatRows<Research extends object> = {
  research?: Research | null;
  /** The perk ranks they own (player_prestige_perk, the expansion and card perk rows). */
  perks?: Partial<PrestigePerkRanks> | null;
  soul?: Partial<SoulStats> | null;
  activeCards?: ActiveCards | null;
  /** The bonus item ids they switched off (player_bonus_toggle). */
  bonusOff?: Iterable<string> | null;
  prestigeChallenge?: PrestigeChallenge | null;
  aggroChallenge?: AggroChallenge | null;
  /** Weapon Mastery levels by school (player_mastery_level). */
  mastery?: Partial<Record<WeaponSchool, number>> | null;
};

const NO_PERKS = Object.freeze(Object.fromEntries(PRESTIGE_PERK_IDS.map(perk => [perk, 0]))) as Readonly<PrestigePerkRanks>;

export function bonusesInPlay<Research extends object>(rows: PublicStatRows<Research>) {
  const off = new Set(rows.bonusOff ?? []);
  const aggro = prestigeBonusesOff(rows.aggroChallenge), challenge = aggro || Boolean(rows.prestigeChallenge?.active);
  // Card slots and the cap keep the perks switched on during an Aggro run; everything else plays without them.
  const owned = perksInPlayFor({ ...rows.perks }, off);
  const cardIds = activeCardsInPlay(rows.activeCards ?? NO_ACTIVE_CARDS, aggro ? BASE_CARD_SLOTS : activeCardSlots(owned));
  const cards = cardTotals(cardIds), cap = playerAttackCap(reflectRewardsOn(off) ? rows.prestigeChallenge : null, owned);
  const raise = cardStatFactors(cards).attackCapRaise;
  return {
    research: researchInPlayFor(rows.research, off) ?? null,
    perks: aggro ? { ...NO_PERKS } : owned,
    soul: challenge || !rows.soul ? null : soulInPlayFor(cleanSoulStats(rows.soul), off),
    cardIds, cards,
    attackCap: raise > 0 ? { ...cap, raise: cap.raise + raise } : cap,
    /** Mastery counts for nothing during either challenge. */
    mastery: challenge ? null : rows.mastery ?? null,
  };
}

/** masteryInPlay from school levels rather than points: the right hand's school, at 0 unless its weapon is in use. */
export function masteryInPlayAtLevels(levels: Partial<Record<WeaponSchool, number>> | null | undefined, rightHand: string | undefined,
  weaponInUse = rightHand): MasteryInPlay {
  const school = weaponSchool(rightHand);
  return { school, level: weaponSchool(weaponInUse) === school ? Math.max(0, Math.floor(Number(levels?.[school]) || 0)) : 0 };
}
