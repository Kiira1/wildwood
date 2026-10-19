import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { masteryPointsForLevel, type WeaponSchool } from "../../shared/weapon-mastery";
import { staffSkillReachMultiplier } from "../../shared/staff-skills";
import { createCombatReport } from "./boss-combat";
import { masteryInPlayFor, masteryKey } from "./weapon-mastery";
import { setSwordSkillRoll } from "./sword-skills";
import { setStaffSkillRoll } from "./staff-skills";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
const train = (f: Fixture, school: WeaponSchool, who = f.ctx.sender, level = 50) =>
  f.seed("playerWeaponMastery", { key: masteryKey(who, school), identity: who, school, points: BigInt(masteryPointsForLevel(level)) });
const holding = (f: Fixture, itemId: string) => f.patch("playerProgress", { inventoryJson: JSON.stringify([itemId]), equippedRightHand: itemId,
  ionCitadelUnlocked: true, equippedHead: "", equippedChest: "" });
function bound(f: Fixture) {
  const { combatBoundForReport } = createCombatReport({ attackIntervalForProgress: progress => progress.attackRate,
    itemUpgradeLevelFor: () => 0, inventoryForProgress: progress => JSON.parse(progress.inventoryJson),
    equippedRightHandForProgress: progress => progress.equippedRightHand, equippedLeftHandForProgress: progress => progress.equippedLeftHand,
    equippedHeadForProgress: progress => progress.equippedHead, equippedChestForProgress: progress => progress.equippedChest });
  return combatBoundForReport(f.ctx as any).preview({ type: "damage", amount: 0, count: 0 });
}

describe("kill bounds with Weapon Mastery", () => {
  it("counts Skill Proficiency in a sword's reach, and only for the school in hand", () => {
    const f = crystalFixture();
    holding(f, "ion_sword");
    f.patch("playerProgress", { damage: 10, maxHp: 100, regen: 0, armor: 0 });
    f.transaction(() => setSwordSkillRoll(f.ctx as any, f.ctx.sender, "ion_sword", { whirlwind: 10, deflect: 0, shockwave: 10 }));
    const plain = bound(f);
    train(f, "archery");
    expect(bound(f).reach).toBeCloseTo(plain.reach!);
    train(f, "swordplay");
    // 1 + 10% × 18 + 10% × 4 is 3.2; at level 50 each chance is half again, Blade Storm spins a fourth tick and
    // Cleave reaches one more: 1 + 1 + 15% × 24 + 15% × 4.
    expect(bound(f).reach! / plain.reach!).toBeCloseTo(6.2 / 3.2);
  });

  it("counts it in a staff's reach; a bigger blast needs nothing, the burst's target cap is the bound", () => {
    const f = crystalFixture();
    holding(f, "ion_staff");
    f.patch("playerProgress", { damage: 10 });
    const roll = { meteor: 10, chain: 10, frostNova: 0 };
    f.transaction(() => setStaffSkillRoll(f.ctx as any, f.ctx.sender, "ion_staff", roll));
    const plain = bound(f);
    train(f, "sorcery");
    // Meteor Shower's second fall counts too.
    expect(bound(f).reach! / plain.reach!).toBeCloseTo(staffSkillReachMultiplier({ meteor: 15, chain: 15 }, 1) / staffSkillReachMultiplier(roll));
  });

  it("lets Reflect answer the bigger hit Swordplay's Guard let less of through", () => {
    const f = crystalFixture();
    holding(f, "ion_sword");
    f.patch("playerProgress", { damage: 10, maxHp: 1_000, regen: 0, armor: 0 });
    f.seed("playerPrestigePerk", { identity: f.ctx.sender, riposte: 1 });
    const plain = bound(f);
    // Level 20 for the Guard alone: Bloodlust (30) heals more for Reflect to answer.
    train(f, "swordplay", f.ctx.sender, 20);
    expect(bound(f).reflectDps! / plain.reflectDps!).toBeCloseTo(1 / .96);
  });
});

describe("Weapon Mastery in duels", () => {
  function duelWith(trained: boolean) {
    const f = crystalFixture(), opponent = identity("b");
    holding(f, "ion_sword");
    f.patch("playerProgress", { damage: 10, maxHp: 10_000 });
    f.progress(opponent, { inventoryJson: '["starter_bow"]', equippedRightHand: "starter_bow", damage: 10, maxHp: 10_000 });
    f.seed("playerProfile", { identity: opponent, displayName: "Opponent" });
    f.seed("player", { ...f.db.player.identity.find(f.ctx.sender), identity: opponent });
    f.transaction(() => setSwordSkillRoll(f.ctx as any, f.ctx.sender, "ion_sword", { whirlwind: 10, deflect: 4, shockwave: 0 }));
    // Level 9: Skill Proficiency and Guard without a technique (mastery-techniques.test.ts covers those).
    if (trained) { train(f, "swordplay", f.ctx.sender, 9); train(f, "swordplay", opponent, 9); }
    f.run(server.requestDuel, { opponent });
    const duel = [...f.db.duel.iter()][0];
    return { duel, frozen: f.db.duelCombatSnapshot.duelId.find(duel.id) };
  }

  it("freezes each side's Skill Proficiency into its skill chances and Swordplay's Guard into what the other side deals", () => {
    const plain = duelWith(false), trained = duelWith(true);
    expect(plain.frozen).toMatchObject({ challengerWhirlwind: 10, challengerDeflect: 4 });
    expect(trained.frozen.challengerWhirlwind).toBeCloseTo(10.9);
    expect(trained.frozen.challengerDeflect).toBeCloseTo(4.36);
    // The challenger holds a sword: the bow's hits on them are guarded. The opponent's bow trains Archery, not Guard.
    expect(trained.duel.opponentDamage / plain.duel.opponentDamage).toBeCloseTo(1 - .018);
    expect(trained.duel.challengerDamage).toBeCloseTo(plain.duel.challengerDamage);
  });

  it("brings no Mastery into a fight during Reflect Only or an Aggro run", () => {
    const f = crystalFixture();
    train(f, "swordplay");
    expect(masteryInPlayFor(f.ctx as any, f.ctx.sender, "ion_sword").level).toBe(50);
    f.seed("playerAggroChallenge", { identity: f.ctx.sender, active: true, completed: 0 });
    expect(masteryInPlayFor(f.ctx as any, f.ctx.sender, "ion_sword").level).toBe(0);
    const g = crystalFixture();
    train(g, "swordplay");
    g.seed("playerPrestigeChallenge", { identity: g.ctx.sender, active: true, completed: 0 });
    expect(masteryInPlayFor(g.ctx as any, g.ctx.sender, "ion_sword").level).toBe(0);
  });
});
