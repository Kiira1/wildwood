import { activeCardSlots, activeCardsInPlay, NO_ACTIVE_CARDS, type ActiveCards } from "../../shared/active-cards";
import { cardStatFactors, cardTotals } from "../../shared/card-effects";
import { gradeItemId } from "../../shared/grade-equipment";
import { BLACK_BOOTS, STARTER_BOW, type ItemLevel } from "../../shared/items";
import { playerAttackCap, type PrestigePerkRanks } from "../../shared/prestige-perks";
import { createEmptyResearchRanks, type ResearchRanks } from "../../shared/research";
import { DEFAULT_ATTACK_INTERVAL, DEFAULT_ATTACK_RANGE, PLAYER_BASE_DAMAGE, PLAYER_BASE_HP, PLAYER_BASE_REGEN, PLAYER_SPEED } from "../../shared/rules";
import type { SoulStats } from "../../shared/soul-dimension";
import type { AttackCap } from "../../shared/stat-rating";
import { masteryPointsForLevel, type MasteryPoints } from "../../shared/weapon-mastery";
import type { SlotTiers } from "../../shared/slot-upgrades";

/** Three players for the stat golden tests: a new account, a mid-campaign build and an endgame prestige build. */
export type StatFixture = {
  name: string;
  /** The run's saved stats, without the soul's share. */
  saved: { maxHp: number; damage: number; armor: number; regen: number; attackRate: number; attackRange: number; speed: number; speedOverride: number; critRating: number };
  loadout: { head: string; chest: string; feet: string; rightHand: string; leftHand: string };
  slotTiers: SlotTiers;
  refines: Record<string, number>;
  research: ResearchRanks;
  perks: Partial<PrestigePerkRanks>;
  cards: ActiveCards;
  soul: SoulStats | null;
  mastery: MasteryPoints;
  prestigeLevel: number;
  guildBonus: number;
};

const ranks = (values: Partial<ResearchRanks>): ResearchRanks => ({ ...createEmptyResearchRanks(), ...values });

export const STAT_FIXTURES: readonly StatFixture[] = [
  {
    name: "fresh",
    saved: { maxHp: PLAYER_BASE_HP, damage: PLAYER_BASE_DAMAGE, armor: 0, regen: PLAYER_BASE_REGEN, attackRate: DEFAULT_ATTACK_INTERVAL,
      attackRange: DEFAULT_ATTACK_RANGE, speed: PLAYER_SPEED, speedOverride: 0, critRating: 0 },
    loadout: { head: "", chest: "", feet: "", rightHand: STARTER_BOW, leftHand: "" },
    slotTiers: {}, refines: {}, research: ranks({}), perks: {}, cards: NO_ACTIVE_CARDS, soul: null, mastery: {}, prestigeLevel: 0, guildBonus: 1,
  },
  {
    name: "mid-campaign",
    saved: { maxHp: 4_200, damage: 380, armor: 45, regen: 9, attackRate: .7, attackRange: DEFAULT_ATTACK_RANGE + 20, speed: PLAYER_SPEED,
      speedOverride: 0, critRating: 30 },
    loadout: { head: gradeItemId("helmet", "rare", "light"), chest: gradeItemId("armor", "rare", "light"), feet: gradeItemId("boots", "rare", "warrior"),
      rightHand: gradeItemId("bow", "rare"), leftHand: "" },
    slotTiers: { HAND: 12, HEAD: 8, CHEST: 10 },
    refines: { [gradeItemId("bow", "rare")]: 6, [gradeItemId("helmet", "rare", "light")]: 3, [gradeItemId("boots", "rare", "warrior")]: 5 },
    research: ranks({ foraging: 10, warcraft: 10, vitality: 8, precision: 6, regeneration: 5, moveSpeed: 5, utilityMoveSpeed: 3, criticalChance: 4,
      criticalDamage: 3, utilityAttackRange: 2 }),
    perks: {},
    cards: { HAND: ["spitter_card"], HEAD: ["bramble_card"], CHEST: ["mossback_card"] },
    soul: null, mastery: { archery: masteryPointsForLevel(10) }, prestigeLevel: 0, guildBonus: 1,
  },
  {
    name: "endgame prestige",
    saved: { maxHp: 2_500_000, damage: 180_000, armor: 2_400, regen: 900, attackRate: .45, attackRange: DEFAULT_ATTACK_RANGE + 50 + 10,
      speed: PLAYER_SPEED, speedOverride: 0, critRating: 400 },
    loadout: { head: gradeItemId("helmet", "eternal", "medium"), chest: gradeItemId("armor", "eternal", "medium"), feet: BLACK_BOOTS,
      rightHand: gradeItemId("sword", "eternal"), leftHand: "" },
    slotTiers: { HAND: 60, HEAD: 55, CHEST: 58 },
    refines: { [gradeItemId("sword", "eternal")]: 20, [gradeItemId("helmet", "eternal", "medium")]: 15, [gradeItemId("armor", "eternal", "medium")]: 18 },
    research: ranks({ foraging: 40, warcraft: 60, vitality: 55, precision: 50, regeneration: 45, moveSpeed: 25, utilityMoveSpeed: 5, criticalChance: 20,
      criticalDamage: 30, critCap: 3, utilityAttackRange: 5 }),
    perks: { keenEdge: 5, fleetFoot: 3, riposte: 4, doubleStrike: 2, splitShot: 1, longShot: 2, quickDraw: 2, weaponCards: 1, helmetCards: 1, armorCards: 1 },
    cards: { HAND: ["ember_raider_card", "magmalisk_card"], HEAD: ["frost_striker_card", "abyss_striker_card"], CHEST: ["rime_guard_card", "reef_archer_card"] },
    soul: { damage: 400, maxHp: 1_500, armor: 60, regen: 12, attackSpeed: .2, critDamage: 25 },
    mastery: { swordplay: masteryPointsForLevel(20) }, prestigeLevel: 6, guildBonus: 1.15,
  },
];

/** The cards in play, as the coop session picks them (account-row-services.ts activeCards). */
export const fixtureCardIds = (fixture: StatFixture) => activeCardsInPlay(fixture.cards, activeCardSlots(fixture.perks));
export const fixtureCardStats = (fixture: StatFixture) => cardStatFactors(cardTotals(fixtureCardIds(fixture)));

/** A worn item's slot tier and refine, as coop.itemLevel gives them. */
export function fixtureItemLevel(fixture: StatFixture) {
  return (itemId: string): ItemLevel => {
    const slot = itemId && itemId === fixture.loadout.rightHand ? "HAND" : itemId === fixture.loadout.head ? "HEAD" : itemId === fixture.loadout.chest ? "CHEST" : null;
    return { tier: slot ? fixture.slotTiers[slot] ?? 0 : 0, refine: fixture.refines[itemId] ?? 0 };
  };
}

/** The attack speed cap in play (progression-service.ts attackCapInPlay). */
export function fixtureAttackCap(fixture: StatFixture): AttackCap {
  const cap = playerAttackCap(null, fixture.perks), cards = fixtureCardStats(fixture).attackCapRaise;
  return cards > 0 ? { ...cap, raise: cap.raise + cards } : cap;
}

