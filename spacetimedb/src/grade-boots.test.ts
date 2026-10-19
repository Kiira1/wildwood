import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { gradeItemId } from "../../shared/grade-equipment";
import { BOOT_SKILL_CHANCE_PERCENT, GRADE_BONUS_PERCENT } from "../../shared/gear-grades";
import { PLAYER_SPEED } from "../../shared/rules";
import { staffSkillReachMultiplier } from "../../shared/staff-skills";
import { createCombatReport } from "./boss-combat";
import { setSwordSkillRoll } from "./sword-skills";
import { setStaffSkillRoll } from "./staff-skills";
import { setRefineLevel } from "./item-refine";
import { itemLevelFor } from "./progress-helpers";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
/** Holds `weapon` and wears `feet`, both in the bag. */
const wearing = (f: Fixture, weapon: string, feet = "", who = f.ctx.sender) => f.patch("playerProgress", {
  inventoryJson: JSON.stringify([weapon, feet].filter(Boolean)), equippedRightHand: weapon, equippedLeftHand: "",
  equippedHead: "", equippedChest: "", equippedFeet: feet, ionCitadelUnlocked: true, damage: 10, maxHp: 1_000, regen: 0, armor: 100 }, who);
function bound(f: Fixture) {
  const { combatBoundForReport } = createCombatReport({ attackIntervalForProgress: progress => progress.attackRate,
    itemUpgradeLevelFor: (ctx, who, itemId) => itemLevelFor(ctx, who, itemId), inventoryForProgress: progress => JSON.parse(progress.inventoryJson),
    equippedRightHandForProgress: progress => progress.equippedRightHand, equippedLeftHandForProgress: progress => progress.equippedLeftHand,
    equippedHeadForProgress: progress => progress.equippedHead, equippedChestForProgress: progress => progress.equippedChest });
  return combatBoundForReport(f.ctx as any).preview({ type: "damage", amount: 0, count: 0 });
}

describe("Ranger Boots in the movement checks", () => {
  const ranger = gradeItemId("boots", "rare", "ranger"), fast = PLAYER_SPEED * 1.08;

  it("allows their speed, and keeps movement at it", () => {
    const f = crystalFixture();
    wearing(f, "starter_bow", ranger);
    f.run(server.setSpeed, { speed: fast });
    f.patch("player", { speed: PLAYER_SPEED });
    f.run(server.updateMovementState, { x: 4050, y: 4050, vx: fast, vy: 0, simulationTick: 1, motionEpoch: 1, sequence: 1 });
    expect(f.db.playerMotion.identity.find(f.ctx.sender)!.vx).toBeCloseTo(fast);
  });

  it("refuses it in other boots, and allows more at a refine", () => {
    const f = crystalFixture();
    wearing(f, "starter_bow", gradeItemId("boots", "rare", "warrior"));
    expect(() => f.run(server.setSpeed, { speed: fast })).toThrow("Unsupported player speed");
    wearing(f, "starter_bow", ranger);
    expect(() => f.run(server.setSpeed, { speed: PLAYER_SPEED * 1.12 })).toThrow("Unsupported player speed");
    f.transaction(() => setRefineLevel(f.ctx as any, f.ctx.sender, ranger, 0n, 10));
    f.run(server.setSpeed, { speed: PLAYER_SPEED * 1.12 });
    expect(f.db.player.identity.find(f.ctx.sender)!.speed).toBeCloseTo(PLAYER_SPEED * 1.12);
  });
});

describe("Mystic Boots in kill bounds", () => {
  it("counts their skill chance in a staff's reach, at their refine", () => {
    const f = crystalFixture();
    const roll = { meteor: 10, chain: 10, frostNova: 0 }, mystic = gradeItemId("boots", "rare", "mystic");
    wearing(f, "ion_staff");
    f.transaction(() => setStaffSkillRoll(f.ctx as any, f.ctx.sender, "ion_staff", roll));
    const plain = bound(f).reach!;
    wearing(f, "ion_staff", mystic);
    const raised = 10 * (1 + BOOT_SKILL_CHANCE_PERCENT.rare / 100);
    expect(bound(f).reach! / plain).toBeCloseTo(staffSkillReachMultiplier({ meteor: raised, chain: raised }) / staffSkillReachMultiplier(roll));
    f.transaction(() => setRefineLevel(f.ctx as any, f.ctx.sender, mystic, 0n, 10));
    const refined = 10 * (1 + BOOT_SKILL_CHANCE_PERCENT.rare * 1.5 / 100);
    expect(bound(f).reach! / plain).toBeCloseTo(staffSkillReachMultiplier({ meteor: refined, chain: refined }) / staffSkillReachMultiplier(roll));
  });
});

describe("graded boots in duels", () => {
  function duelWearing(feet: string) {
    const f = crystalFixture(), opponent = identity("b");
    wearing(f, "ion_sword", feet);
    f.progress(opponent, { inventoryJson: '["starter_bow"]', equippedRightHand: "starter_bow", damage: 10, maxHp: 10_000 });
    f.seed("playerProfile", { identity: opponent, displayName: "Opponent" });
    f.seed("player", { ...f.db.player.identity.find(f.ctx.sender), identity: opponent });
    f.transaction(() => setSwordSkillRoll(f.ctx as any, f.ctx.sender, "ion_sword", { whirlwind: 10, deflect: 4, shockwave: 0 }));
    f.run(server.requestDuel, { opponent });
    const duel = [...f.db.duel.iter()][0];
    return { duel, frozen: f.db.duelCombatSnapshot.duelId.find(duel.id) };
  }

  it("freezes Mystic Boots' skill chance and Warrior Boots' armor into the duel", () => {
    const plain = duelWearing(""), mystic = duelWearing(gradeItemId("boots", "rare", "mystic")), warrior = duelWearing(gradeItemId("boots", "rare", "warrior"));
    expect(plain.frozen).toMatchObject({ challengerWhirlwind: 10, challengerDeflect: 4 });
    expect(mystic.frozen.challengerWhirlwind).toBeCloseTo(10 * (1 + BOOT_SKILL_CHANCE_PERCENT.rare / 100));
    expect(mystic.duel.challengerArmor).toBeCloseTo(plain.duel.challengerArmor);
    expect(warrior.duel.challengerArmor / plain.duel.challengerArmor).toBeCloseTo(1 + GRADE_BONUS_PERCENT.rare / 100);
    expect(warrior.frozen.challengerWhirlwind).toBeCloseTo(10);
  });
});
