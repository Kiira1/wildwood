import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { gradeItemId } from "../../shared/grade-equipment";
import type { ArmorClass } from "../../shared/gear-grades";
import { PLAYER_SPEED } from "../../shared/rules";
import { staffSkillReachMultiplier } from "../../shared/staff-skills";
import { createCombatReport } from "./boss-combat";
import { setSwordSkillRoll } from "./sword-skills";
import { setStaffSkillRoll } from "./staff-skills";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
const helmet = (armorClass: ArmorClass) => gradeItemId("helmet", "rare", armorClass);
const armor = (armorClass: ArmorClass) => gradeItemId("armor", "rare", armorClass);
/** Holds `weapon` and wears `head` and `chest`, all in the bag. */
const wearing = (f: Fixture, weapon: string, head = "", chest = "", who = f.ctx.sender) => f.patch("playerProgress", {
  inventoryJson: JSON.stringify([weapon, head, chest].filter(Boolean)), equippedRightHand: weapon, equippedLeftHand: "",
  equippedHead: head, equippedChest: chest, ionCitadelUnlocked: true, damage: 10, maxHp: 1_000, regen: 0, armor: 0 }, who);
function bound(f: Fixture) {
  const { combatBoundForReport } = createCombatReport({ attackIntervalForProgress: progress => progress.attackRate,
    itemUpgradeLevelFor: () => 0, inventoryForProgress: progress => JSON.parse(progress.inventoryJson),
    equippedRightHandForProgress: progress => progress.equippedRightHand, equippedLeftHandForProgress: progress => progress.equippedLeftHand,
    equippedHeadForProgress: progress => progress.equippedHead, equippedChestForProgress: progress => progress.equippedChest });
  return combatBoundForReport(f.ctx as any).preview({ type: "damage", amount: 0, count: 0 });
}

describe("armor classes in the movement checks", () => {
  const light = PLAYER_SPEED * 1.06;

  it("allows Light armor's speed, and keeps movement at it", () => {
    const f = crystalFixture();
    wearing(f, "starter_bow", helmet("light"), armor("light"));
    f.run(server.setSpeed, { speed: light });
    f.patch("player", { speed: PLAYER_SPEED });
    f.run(server.updateMovementState, { x: 4050, y: 4050, vx: light, vy: 0, simulationTick: 1, motionEpoch: 1, sequence: 1 });
    expect(f.db.playerMotion.identity.find(f.ctx.sender)!.vx).toBeCloseTo(light);
  });

  it("refuses it without both Light pieces, and does not hold Heavy armor to its slower speed", () => {
    const f = crystalFixture();
    wearing(f, "starter_bow", helmet("light"), armor("medium"));
    expect(() => f.run(server.setSpeed, { speed: light })).toThrow("Unsupported player speed");
    wearing(f, "starter_bow", helmet("heavy"), armor("heavy"));
    f.run(server.setSpeed, { speed: PLAYER_SPEED * .92 });
    f.run(server.setSpeed, { speed: PLAYER_SPEED });
    expect(f.db.player.identity.find(f.ctx.sender)!.speed).toBeCloseTo(PLAYER_SPEED);
    f.run(server.updateMovementState, { x: 4050, y: 4050, vx: PLAYER_SPEED, vy: 0, simulationTick: 1, motionEpoch: 1, sequence: 1 });
    expect(f.db.playerMotion.identity.find(f.ctx.sender)!.vx).toBeCloseTo(PLAYER_SPEED);
  });
});

describe("armor classes in kill bounds", () => {
  it("counts the class set's damage, and not without it", () => {
    const f = crystalFixture();
    // Light and Magic pieces of a grade give the same share, so only the set differs.
    wearing(f, "starter_bow", helmet("light"), armor("light"));
    const set = bound(f).dps!;
    wearing(f, "starter_bow", helmet("magic"), armor("magic"));
    expect(set / bound(f).dps!).toBeCloseTo(1.05);
    wearing(f, "starter_bow", helmet("light"), "");
    const missing = bound(f).dps!;
    wearing(f, "starter_bow", helmet("magic"), "");
    expect(missing / bound(f).dps!).toBeCloseTo(1);
    wearing(f, "ion_sword", helmet("heavy"), armor("heavy"));
    const heavy = bound(f).dps!;
    wearing(f, "ion_sword", helmet("medium"), armor("medium"));
    expect(bound(f).dps! / heavy).toBeCloseTo(1.05);
  });

  it("counts Magic armor's skill chance in a staff's reach", () => {
    const f = crystalFixture();
    const roll = { meteor: 10, chain: 10, frostNova: 0 };
    wearing(f, "ion_staff", helmet("light"), armor("light"));
    f.transaction(() => setStaffSkillRoll(f.ctx as any, f.ctx.sender, "ion_staff", roll));
    const plain = bound(f).reach!;
    wearing(f, "ion_staff", helmet("magic"), armor("magic"));
    expect(bound(f).reach! / plain).toBeCloseTo(staffSkillReachMultiplier({ meteor: 10.6, chain: 10.6 }) / staffSkillReachMultiplier(roll));
  });
});

describe("armor classes in duels", () => {
  function duelWearing(head: string, chest: string) {
    const f = crystalFixture(), opponent = identity("b");
    wearing(f, "ion_sword", head, chest);
    f.progress(opponent, { inventoryJson: '["starter_bow"]', equippedRightHand: "starter_bow", damage: 10, maxHp: 10_000 });
    f.seed("playerProfile", { identity: opponent, displayName: "Opponent" });
    f.seed("player", { ...f.db.player.identity.find(f.ctx.sender), identity: opponent });
    f.transaction(() => setSwordSkillRoll(f.ctx as any, f.ctx.sender, "ion_sword", { whirlwind: 10, deflect: 4, shockwave: 0 }));
    f.run(server.requestDuel, { opponent });
    const duel = [...f.db.duel.iter()][0];
    return { duel, frozen: f.db.duelCombatSnapshot.duelId.find(duel.id) };
  }

  it("freezes Magic armor's skill chance and the class set's damage into the duel", () => {
    const plain = duelWearing("", ""), magic = duelWearing(helmet("magic"), armor("magic")), set = duelWearing(helmet("medium"), armor("medium"));
    expect(plain.frozen).toMatchObject({ challengerWhirlwind: 10, challengerDeflect: 4 });
    expect(magic.frozen.challengerWhirlwind).toBeCloseTo(10.6);
    expect(magic.frozen.challengerDeflect).toBeCloseTo(4.24);
    expect(magic.duel.challengerDamage).toBeCloseTo(plain.duel.challengerDamage);
    expect(set.frozen.challengerWhirlwind).toBeCloseTo(10);
    expect(set.duel.challengerDamage / plain.duel.challengerDamage).toBeCloseTo(1.05);
  });
});
