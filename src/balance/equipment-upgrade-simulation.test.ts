import { describe, expect, it, vi } from "vitest";
import { gradeShopLinesFor } from "./smith-purchases";
import { advanceTime, buyGradeGear, runBalanceSimulation, startNextEquipmentUpgrade, simulationUpgradeLevel } from "./simulator";
import { BASIC_PAPER_HAT, IRON_BOW, STARTER_STONE, itemUpgradeDurationMs } from "../../shared/items";
import { isGradeItemId } from "../../shared/grade-equipment";
import { masteryPointsForLevel } from "../../shared/weapon-mastery";
import { GRADE_GOLD_PRICE } from "../../shared/gear-grades";
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

  it("buys what the Smith offers on each line while gold allows, cheapest first, and wears the set", () => {
    const state = smith(40, 0), recorded = vi.fn();
    buyGradeGear(state, recorded);
    expect(state.equipped).toEqual({ weapon: "crude_bow", chest: "crude_light_armor", head: "crude_light_helmet" });
    expect(state.gold).toBe(40 - 3 * GRADE_GOLD_PRICE.crude);
    expect(recorded).toHaveBeenCalledTimes(3);
    expect(gradeShopLinesFor(state.equipped.weapon)).toEqual([{ kind: "bow" }, { kind: "armor", armorClass: "light" }, { kind: "helmet", armorClass: "light" }]);
  });

  it("waits for Mastery to open a grade, then buys the highest it opens and affords, skipping those between", () => {
    const state = smith(10_000, 0);
    buyGradeGear(state, vi.fn());
    expect(state.equipped.weapon).toBe("crude_bow");
    expect(state.gold).toBe(10_000 - 3 * GRADE_GOLD_PRICE.crude);
    state.masteryPoints.archery = masteryPointsForLevel(5);
    buyGradeGear(state, vi.fn());
    expect(state.equipped).toEqual({ weapon: "rare_bow", chest: "rare_light_armor", head: "rare_light_helmet" });
    expect([...state.ownedItems].filter(id => id.startsWith("common_"))).toEqual([]);
    expect(state.gold).toBe(10_000 - 3 * GRADE_GOLD_PRICE.crude - 3 * GRADE_GOLD_PRICE.rare);
  });

  it("on a tie, buys for the line furthest behind first", () => {
    const state = smith(GRADE_GOLD_PRICE.rare, 0);
    for (const itemId of ["fine_bow", "crude_light_armor", "fine_light_helmet"]) state.ownedItems.add(itemId);
    state.masteryPoints.archery = masteryPointsForLevel(5);
    buyGradeGear(state, vi.fn());
    expect(state.ownedItems.has("rare_light_armor")).toBe(true);
    expect(state.ownedItems.has("rare_bow")).toBe(false);
  });

  it("buys the best open grade the gold covers when the highest is out of reach", () => {
    const state = smith(GRADE_GOLD_PRICE.rare - 1, 0);
    state.ownedItems.add("crude_bow");
    state.equipped.weapon = "crude_bow";
    for (const itemId of ["rare_light_armor", "rare_light_helmet"]) state.ownedItems.add(itemId);
    state.masteryPoints.archery = masteryPointsForLevel(5);
    buyGradeGear(state, vi.fn());
    expect(state.equipped.weapon).toBe("superior_bow");
    expect(state.gold).toBe(GRADE_GOLD_PRICE.rare - 1 - GRADE_GOLD_PRICE.superior);
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
