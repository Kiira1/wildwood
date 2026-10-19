import { describe, expect, it } from "vitest";
import { createPlayerCombatController } from "./player-combat-controller";
import { createResearchController } from "./research-controller";
import { createGameBootstrap } from "./game-bootstrap";
import { TUTORIAL_FOREST_MAP_ID } from "../world";
import { gradeItemId } from "../../../shared/grade-equipment";
import { BOOT_MOVE_SPEED_PERCENT, BOOT_SKILL_CHANCE_PERCENT, GRADE_BONUS_PERCENT } from "../../../shared/gear-grades";
import { createEmptyResearchRanks } from "../../../shared/research";
import type { ItemLevel } from "../../../shared/items";

/** A combat controller holding a bow with `feet` worn at `level`, and a bow roll of 10% Arrow Storm. */
function combat(feet = "", level: ItemLevel = 0) {
  const state = createGameBootstrap();
  const noop = () => {};
  Object.assign(state.player, { damage: 10, attackRate: .5, projectileCount: 1 });
  return createPlayerCombatController({
    player: state.player, enemies: state.enemies, spawnSites: state.spawnSites, projectileStore: state.projectileStore, bosses: state.bosses,
    nowSeconds: () => 0, currentMapId: () => TUTORIAL_FOREST_MAP_ID, engageEnemy: noop,
    researchDamageMultiplier: () => 1, researchCriticalChance: () => 0, researchCriticalDamageMultiplier: () => 2, researchRewardMultiplier: () => 1,
    equippedWeapon: () => "common_bow", equippedHead: () => "", equippedChest: () => "", equippedFeet: () => feet, equippedFeetUpgradeLevel: () => level,
    healthMultiplierBonus: () => 0, minAttackInterval: .05, effectiveArmor: () => 0, isDueling: () => false, scheduleEnemyRespawn: noop,
    recordRegularEnemyDefeat: noop, incrementKills: noop, spawnBurst: noop, spawnParticle: noop, spawnDamageNumber: noop, logPickup: noop,
    saveProgress: noop, recordDeath: noop, endGame: noop, weaponSkills: () => ({ arrowStorm: 10 }) as never,
  });
}

describe("graded boots in local combat", () => {
  it("walks faster in Ranger Boots, more with the grade and the refine, and not in the other styles", () => {
    expect(combat().moveSpeedFactor()).toBe(1);
    expect(combat("black_boots").moveSpeedFactor()).toBe(1);
    expect(combat(gradeItemId("boots", "crude", "ranger")).moveSpeedFactor()).toBeCloseTo(1.02);
    expect(combat(gradeItemId("boots", "eternal", "ranger")).moveSpeedFactor()).toBeCloseTo(1 + BOOT_MOVE_SPEED_PERCENT.eternal / 100);
    // A refine multiplies the pair's stat; feet have no slot tier, so a tier passed in counts for nothing.
    expect(combat(gradeItemId("boots", "rare", "ranger"), { tier: 30, refine: 10 }).moveSpeedFactor()).toBeCloseTo(1 + BOOT_MOVE_SPEED_PERCENT.rare * 1.5 / 100);
    expect(combat(gradeItemId("boots", "eternal", "warrior")).moveSpeedFactor()).toBe(1);
  });

  it("raises weapon skill chances in Mystic Boots, as Magic armor does", () => {
    const skillShare = (feet = "") => { const c = combat(feet); return c.expectedFullDps() / c.expectedDps() - 1; };
    expect(skillShare(gradeItemId("boots", "legendary", "mystic")) / skillShare()).toBeCloseTo(1 + BOOT_SKILL_CHANCE_PERCENT.legendary / 100);
    expect(skillShare(gradeItemId("boots", "legendary", "ranger")) / skillShare()).toBeCloseTo(1);
  });

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
