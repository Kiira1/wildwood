import { describe, expect, it } from "vitest";
import { createResearchController } from "./research-controller";
import { createGameBootstrap } from "./game-bootstrap";
import { gradeItemId } from "../../../shared/grade-equipment";
import { GRADE_BONUS_PERCENT } from "../../../shared/gear-grades";
import { createEmptyResearchRanks } from "../../../shared/research";

// Walking and skill chance in boots are in tests/scenarios/gear.test.ts (GEAR-04); armor is read here.
describe("graded boots in local combat", () => {
  it("raises armor in Warrior Boots, at their refine", () => {
    const player = createGameBootstrap().player;
    player.armor = 100;
    let feet = "";
    const research = createResearchController({ player, getRanks: () => ({ ...createEmptyResearchRanks(), precision: 5 }), isDueling: () => false,
      maxPlayerStat: 1e9, saveProgress: () => {}, equippedFeet: () => feet, itemLevel: () => ({ refine: 10 }) });
    expect(research.effectiveArmor()).toBeCloseTo(110);
    feet = gradeItemId("boots", "epic", "warrior");
    expect(research.effectiveArmor()).toBeCloseTo(100 * (1 + GRADE_BONUS_PERCENT.epic * 1.5 / 100) * 1.1);
    feet = gradeItemId("boots", "epic", "ranger");
    expect(research.effectiveArmor()).toBeCloseTo(110);
  });
});
