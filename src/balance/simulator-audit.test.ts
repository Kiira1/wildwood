import { expect, it } from "vitest";
import { createEmptyResearchRanks } from "../../shared/research";
import { simulateExistingPlayer, type ExistingPlayerSimulation } from "./simulator";

function snapshot(): ExistingPlayerSimulation {
  return {
    stats: { damage: 100, maxHp: 100, armor: 5, regen: 1, attackRate: 1 },
    research: createEmptyResearchRanks(),
    equipped: { head: "", chest: "", weapon: "starter_bow" },
    ownedItems: ["starter_bow", "ion_bow"],
    bootsEquipped: false, itemUpgradeLevel: 0, equipmentStrengthMultiplier: 1,
    mapIndex: 0, bossRewardClaims: 0, highestUnlockedMapIndex: 0,
  };
}

it("audits an existing save without changing the input or granting access to higher maps", () => {
  const input = snapshot(), original = structuredClone(input);
  const result = simulateExistingPlayer({ durationSeconds: 60, trials: 1, steadyEquipmentUpgrades: false }, input);
  expect(input).toEqual(original);
  expect(result.maps).toHaveLength(1);
  expect(result.maps[0].mapId).toBe("tutorial_forest");
  expect(result.maps[0].entryPower).toBeGreaterThan(100);
  expect(result.finalState.stats.damage).toBeGreaterThanOrEqual(input.stats.damage);
  expect(result.finalState.equipped.weapon).toBe("starter_bow");
});

it("starts from the supplied campaign map and exposes the actual final stats", () => {
  const input = snapshot(); input.mapIndex = 8; input.highestUnlockedMapIndex = 8;
  input.stats.damage = 1_000_000;
  const config = { durationSeconds: 60, trials: 1, seed: 21 };
  const result = simulateExistingPlayer(config, input);
  expect(result.maps[0].mapId).toBe("moonfen");
  expect(result.finalState.stats.damage).toBeGreaterThanOrEqual(1_000_000);
  expect(result).toEqual(simulateExistingPlayer(config, input));
});
