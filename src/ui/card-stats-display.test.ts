import { describe, expect, it } from "vitest";
import { createEmptyResearchRanks } from "../../shared/research";
import { MIN_ATTACK_INTERVAL, MAX_PLAYER_STAT } from "../../shared/rules";
import { STARTER_BOW, WOODEN_ARMOR } from "../../shared/items";
import { cardStatFactors, cardTotals } from "../../shared/card-effects";
import { createResearchController } from "../game/runtime/research-controller";
import { profilePower, profileStatDisplayRows } from "./profile";

const WORN = ["ember_raider_card", "mossback_card", "brood_card", "striker_card", "dune_striker_card", "tempest_kirin_card"];

function research(cards?: ReturnType<typeof cardStatFactors>) {
  return createResearchController({
    player: { damage: 1, maxHp: 100, armor: 40, regen: 1, attackRate: 1, speed: 200, critRating: 0 } as any,
    getRanks: () => ({ ...createEmptyResearchRanks(), warcraft: 5, precision: 5, regeneration: 5, criticalChance: 10 }),
    isDueling: () => false, maxPlayerStat: MAX_PLAYER_STAT, saveProgress: () => {}, cards: () => cards,
  });
}

describe("cards in the client's stats", () => {
  it("adds worn cards to damage, armor, regen, crit and move speed, and nothing without them", () => {
    const plain = research(), carded = research(cardStatFactors(cardTotals(WORN)));
    expect(carded.damageMultiplier()).toBeCloseTo(plain.damageMultiplier() * 1.049, 9);
    expect(carded.effectiveArmor()).toBeCloseTo(plain.effectiveArmor() * 1.03, 9);
    expect(carded.regenerationMultiplier()).toBeCloseTo(plain.regenerationMultiplier() * 1.04, 9);
    expect(carded.criticalChance()).toBeCloseTo(plain.criticalChance() + .01, 9);
    expect(carded.criticalDamageMultiplier(0, 40)).toBeCloseTo(plain.criticalDamageMultiplier(0, 40) * 1.06, 9);
    expect(carded.movementSpeedMultiplier()).toBeCloseTo(plain.movementSpeedMultiplier() * 1.12, 9);
  });
});

describe("cards on the profile", () => {
  const profile = (cards = true) => ({
    progress: { maxHp: 100, damage: 20, attackRate: 1, armor: 10, regen: 2, speed: 190, speedOverride: 0, attackRange: 260, critRating: 0,
      equippedRightHand: STARTER_BOW, equippedChest: WOODEN_ARMOR, equippedHead: "", equippedLeftHand: "" },
    research: createEmptyResearchRanks(), itemUpgradeLevels: {}, itemRefines: {},
    itemCardSlots: cards ? { [STARTER_BOW]: { slots: 1, cards: ["ember_raider_card"] }, [WOODEN_ARMOR]: { slots: 1, cards: ["mossback_card"] } } : {},
  }) as unknown as Parameters<typeof profileStatDisplayRows>[0];

  it("lists what the worn cards add, a cost included, and counts them in each total", () => {
    const rows = (withCards: boolean) => profileStatDisplayRows(profile(withCards), () => "0%", MIN_ATTACK_INTERVAL);
    const row = (withCards: boolean, kind: string) => rows(withCards).find(entry => entry.kind === kind)!;
    expect(row(true, "damage").sources).toContainEqual({ label: "Cards", value: "+4.9%" });
    expect(row(true, "health").sources).toContainEqual({ label: "Cards", value: "-3.6%" });
    expect(row(true, "armor").sources).toContainEqual({ label: "Cards", value: "+3%" });
    expect(row(false, "damage").sources.some(source => source.label === "Cards")).toBe(false);
    expect(Number(row(true, "armor").multiplier)).toBeCloseTo(1.03, 2);
    expect(profilePower(profile(true))).not.toBe(profilePower(profile(false)));
  });
});
