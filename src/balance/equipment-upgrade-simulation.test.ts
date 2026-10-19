import { describe, expect, it, vi } from "vitest";
import { gradeShopLinesFor } from "./smith-purchases";
import { advanceTime, buyGradeGear, runBalanceSimulation, startNextEquipmentUpgrade, simulationUpgradeLevel } from "./simulator";
import { BASIC_PAPER_HAT, IRON_BOW, STARTER_STONE, itemUpgradeDurationMs } from "../../shared/items";
import { isGradeItemId } from "../../shared/grade-equipment";
import { masteryPointsForLevel } from "../../shared/weapon-mastery";
import { createEmptyResearchRanks } from "../../shared/research";

function fixture() {
  return {
    time: 0, mapIndex: 1, missingHealth: 0,
    stats: { damage: 100, maxHp: 1000, armor: 10, regen: 1, attackRate: 1 },
    research: createEmptyResearchRanks(),
    equipped: { head: "", chest: "", weapon: IRON_BOW },
    ownedItems: new Set<string>([IRON_BOW, STARTER_STONE]),
    bootsEquipped: true, itemUpgradeLevel: 0, itemUpgradeLevels: {} as Record<string, number>,
    equipmentStrengthMultiplier: 1, steadyEquipmentUpgrades: true,
    activeUpgrade: null as { itemId: string; completesAt: number; level: number } | null,
    activeResearch: null, bossRewardClaims: 0, gold: 0, masteryPoints: {} as { archery?: number },
  };
}

describe("steady simulated equipment upgrades", () => {
  it("keeps equipment usable and applies completed tiers to the whole slot", () => {
    const state = fixture();
    startNextEquipmentUpgrade(state);
    expect(state.activeUpgrade?.itemId).toBe(IRON_BOW);
    expect(state.equipped.weapon).toBe(IRON_BOW);
    const duration = itemUpgradeDurationMs(0) / 1000;
    state.steadyEquipmentUpgrades = false;
    advanceTime(state, duration - 1, "off", vi.fn());
    expect(state.itemUpgradeLevels.HAND).toBeUndefined();
    advanceTime(state, duration, "off", vi.fn());
    expect(state.itemUpgradeLevels.HAND).toBe(1);
    expect(state.equipped.weapon).toBe(IRON_BOW);
    expect(simulationUpgradeLevel(state, STARTER_STONE)).toBe(1);
    expect(simulationUpgradeLevel(state, IRON_BOW)).toBe(1);
  });

  it("keeps one upgrade active and uses the longer duration for the next level", () => {
    const state = fixture();
    advanceTime(state, itemUpgradeDurationMs(0) / 1000, "off", vi.fn());
    expect(state.itemUpgradeLevels.HAND).toBe(1);
    expect(state.activeUpgrade?.level).toBe(1);
    expect(state.activeUpgrade?.completesAt).toBeCloseTo((itemUpgradeDurationMs(0) + itemUpgradeDurationMs(1)) / 1000, 6);
  });
});

describe("the Smith's graded gear", () => {
  const smith = (gold: number, archery: number) => ({ ...fixture(), mapIndex: 0, gold, masteryPoints: { archery },
    equipped: { head: BASIC_PAPER_HAT, chest: "", weapon: STARTER_STONE }, ownedItems: new Set([BASIC_PAPER_HAT, STARTER_STONE]) });

  it("buys the next grade on each line while gold allows, cheapest first, and wears the set", () => {
    const state = smith(350, 0), recorded = vi.fn();
    buyGradeGear(state, recorded);
    expect(state.equipped).toEqual({ weapon: "common_bow", chest: "common_light_armor", head: "common_light_helmet" });
    expect(state.gold).toBe(50);
    expect(recorded).toHaveBeenCalledTimes(3);
    expect(gradeShopLinesFor(state.equipped.weapon)).toEqual([{ kind: "bow" }, { kind: "armor", armorClass: "light" }, { kind: "helmet", armorClass: "light" }]);
  });

  it("waits for Mastery to open a grade, then buys it", () => {
    const state = smith(10_000, 0);
    buyGradeGear(state, vi.fn());
    expect(state.equipped.weapon).toBe("common_bow");
    expect(state.gold).toBe(10_000 - 300);
    state.masteryPoints.archery = masteryPointsForLevel(5);
    buyGradeGear(state, vi.fn());
    expect(state.equipped).toEqual({ weapon: "uncommon_bow", chest: "uncommon_light_armor", head: "uncommon_light_helmet" });
    expect(state.gold).toBe(10_000 - 300 - 3_000);
  });
});

it("a fresh Lab run earns gold and Mastery from kills and wears only the Smith's gear", () => {
  const run = runBalanceSimulation({ trials: 1, durationSeconds: 3 * 3600, seed: 5 });
  const arrivals = Object.values(run.arrivalStates ?? {});
  const last = arrivals.at(-1)!;
  expect(last.masteryPoints?.archery).toBeGreaterThan(100);
  const worn = arrivals.flatMap(arrival => arrival ? [arrival.equipped.weapon, arrival.equipped.head, arrival.equipped.chest] : []).filter(Boolean);
  expect(worn.every(itemId => [STARTER_STONE, BASIC_PAPER_HAT].includes(itemId) || isGradeItemId(itemId))).toBe(true);
  expect(worn.some(isGradeItemId)).toBe(true);
  expect(run.maps[1].entryMasteryLevelMedian).toBeGreaterThanOrEqual(0);
});
