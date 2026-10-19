import { describe, expect, it } from "vitest";
import { createPlayerCombatController } from "./player-combat-controller";
import { createGameBootstrap } from "./game-bootstrap";
import { TUTORIAL_FOREST_MAP_ID } from "../world";
import { gradeItemId } from "../../../shared/grade-equipment";
import type { ArmorClass } from "../../../shared/gear-grades";

const helmet = (armorClass: ArmorClass) => gradeItemId("helmet", "rare", armorClass);
const armor = (armorClass: ArmorClass) => gradeItemId("armor", "rare", armorClass);

/** A combat controller holding `weapon` with `head` and `chest` worn and a bow roll of 10% Arrow Storm. */
function combat(weapon: string, head = "", chest = "") {
  const state = createGameBootstrap();
  const noop = () => {};
  Object.assign(state.player, { damage: 10, attackRate: .5, projectileCount: 1 });
  return createPlayerCombatController({
    player: state.player, enemies: state.enemies, spawnSites: state.spawnSites, projectileStore: state.projectileStore, bosses: state.bosses,
    nowSeconds: () => 0, currentMapId: () => TUTORIAL_FOREST_MAP_ID, engageEnemy: noop,
    researchDamageMultiplier: () => 1, researchCriticalChance: () => 0, researchCriticalDamageMultiplier: () => 2, researchRewardMultiplier: () => 1,
    equippedWeapon: () => weapon, equippedHead: () => head, equippedChest: () => chest, healthMultiplierBonus: () => 0,
    minAttackInterval: .05, effectiveArmor: () => 0, isDueling: () => false, scheduleEnemyRespawn: noop, recordRegularEnemyDefeat: noop,
    incrementKills: noop, spawnBurst: noop, spawnParticle: noop, spawnDamageNumber: noop, logPickup: noop, saveProgress: noop,
    recordDeath: noop, endGame: noop, weaponSkills: () => ({ arrowStorm: 10 }) as never,
  });
}

describe("armor classes in local combat", () => {
  it("walks 3% faster a Light piece and 4% slower a Heavy one", () => {
    expect(combat("common_bow").moveSpeedFactor()).toBe(1);
    expect(combat("common_bow", helmet("light"), armor("light")).moveSpeedFactor()).toBeCloseTo(1.06);
    expect(combat("common_bow", helmet("light")).moveSpeedFactor()).toBeCloseTo(1.03);
    expect(combat("common_bow", helmet("heavy"), armor("heavy")).moveSpeedFactor()).toBeCloseTo(.92);
    expect(combat("common_bow", helmet("medium"), armor("magic")).moveSpeedFactor()).toBe(1);
  });

  it("raises weapon skill chances 3% of themselves a Magic piece", () => {
    const skillShare = (head = "", chest = "") => { const c = combat("common_bow", head, chest); return c.expectedFullDps() / c.expectedDps() - 1; };
    expect(skillShare(helmet("magic"), armor("magic")) / skillShare()).toBeCloseTo(1.06);
    expect(skillShare(helmet("magic")) / skillShare()).toBeCloseTo(1.03);
    expect(skillShare(helmet("light"), armor("light")) / skillShare()).toBeCloseTo(1);
  });

  it("hits 5% harder with both pieces of the class matching the weapon's school", () => {
    const dps = (weapon: string, head: string, chest: string) => combat(weapon, head, chest).expectedDps();
    // Light and Magic pieces of a grade give the same share, so only the set differs.
    expect(dps("common_bow", helmet("light"), armor("light")) / dps("common_bow", helmet("magic"), armor("magic"))).toBeCloseTo(1.05);
    expect(dps("common_staff", helmet("magic"), armor("magic")) / dps("common_staff", helmet("light"), armor("light"))).toBeCloseTo(1.05);
    expect(dps("common_sword", helmet("medium"), armor("medium")) / dps("common_sword", helmet("heavy"), armor("heavy"))).toBeCloseTo(1.05);
    // A missing or mismatched piece breaks the set.
    expect(dps("common_bow", helmet("light"), "") / dps("common_bow", helmet("magic"), "")).toBeCloseTo(1);
    expect(dps("common_bow", helmet("light"), armor("magic")) / dps("common_bow", helmet("magic"), armor("light"))).toBeCloseTo(1);
  });
});
