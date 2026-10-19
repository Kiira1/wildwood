import { expect, it } from "vitest";
import { CAMPAIGN_UNLOCK_FIELDS } from "./equipment-access";
import { rebaseProgressByEffort, legacyEarnedSeconds, rebalancedProgressAt } from "./progression-rebase";
import { LEGACY_PROGRESS_CURVE, REBALANCED_PROGRESS_CURVE } from "./progression-rebase-curves";
const unlocked = Object.fromEntries(CAMPAIGN_UNLOCK_FIELDS.map(field => [field, true]));
it("maps equal old effort to the new curve at every checkpoint", () => {
  for (const [seconds, power] of LEGACY_PROGRESS_CURVE) expect(legacyEarnedSeconds(power)).toBeCloseTo(seconds, 3);
  for (const [seconds, power] of REBALANCED_PROGRESS_CURVE) expect(rebalancedProgressAt(seconds).power).toBeCloseTo(power, 1);
  expect(REBALANCED_PROGRESS_CURVE.at(-1)![0] / 3600).toBeGreaterThan(127);
  expect(REBALANCED_PROGRESS_CURVE.at(-1)![0] / 3600).toBeLessThan(130);
});
it("keeps late gear owned and worn, preserving earned stat proportions", () => {
  const original = { ...unlocked, damage: 1e21, maxHp: 2e21, armor: 1e20, regen: 1e19, attackRate: .4,
    inventoryJson: '["ion_bow","starter_bow","black_boots"]',
    equippedRightHand: "ion_bow", equippedHead: "", equippedChest: "", equippedFeet: "black_boots", bossRewardClaims: 32767 };
  const result = rebaseProgressByEffort(original, null, () => 10, 20);
  expect(result.mapIndex).toBe(11);
  expect(result.progress.ionCitadelUnlocked).toBe(false);
  expect(result.progress.inventoryJson).toContain("ion_bow");
  expect(result.progress.equippedRightHand).toBe("ion_bow");
  expect(result.progress.maxHp / result.progress.damage).toBeCloseTo(2);
  expect(result.progress.armor / result.progress.damage).toBeCloseTo(.1);
  expect(result.completedEndless).toBe(0);
});
it("never takes owned gear off for a map the rebase locks again", () => {
  const original = { ...unlocked, damage: 10, maxHp: 20, armor: 1, regen: 1, attackRate: .4,
    inventoryJson: '["cloudspire_bow","starter_bow"]',
    equippedRightHand: "", equippedHead: "", equippedChest: "", equippedFeet: "", bossRewardClaims: 32767 };
  const result = rebaseProgressByEffort(original, null, () => 0, 0);
  expect(result.progress.cloudspireUnlocked).toBe(false);
  expect(result.progress.equippedRightHand).toBe("cloudspire_bow");
});
