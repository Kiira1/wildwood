import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { setActiveCards } from "../../tests/helpers/active-cards";
import { createEmptyResearchRanks } from "../../shared/research";
import { masteryPointsForLevel, type WeaponSchool } from "../../shared/weapon-mastery";
import { MANA_SHIELD_REDUCTION } from "../../shared/mastery-techniques";
import { weaponAttackInterval } from "../../shared/staff-skills";
import { createCombatReport } from "./boss-combat";
import { createDuelRuntime } from "./duel-runtime";
import { powerFieldsForProgress, researchedArmor, researchedDamage, researchedRegen } from "./player-power";
import { attackIntervalForProgress } from "./player-speed";
import {
  equipmentPresentationForProgress, equippedChestForProgress, equippedHeadForProgress, equippedLeftHandForProgress, equippedRightHandForProgress,
  inventoryForProgress, itemLevelFor, maxHealthForProgress,
} from "./progress-helpers";
import { masteryKey } from "./weapon-mastery";
import { readPlayerProgress } from "./wide-stats";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
const holding = (f: Fixture, itemId: string, who = f.ctx.sender) => f.patch("playerProgress", { inventoryJson: JSON.stringify([itemId]),
  equippedRightHand: itemId, equippedLeftHand: "", ionCitadelUnlocked: true, equippedHead: "", equippedChest: "" }, who);
const train = (f: Fixture, school: WeaponSchool, level: number) =>
  f.seed("playerWeaponMastery", { key: masteryKey(f.ctx.sender, school), identity: f.ctx.sender, school, points: BigInt(masteryPointsForLevel(level)) });

describe("power the kill reducer writes", () => {
  it("is powerFieldsForProgress: crits counted and research as it plays", () => {
    const f = crystalFixture();
    holding(f, "starter_bow");
    f.patch("playerProgress", { damage: 500, maxHp: 4_000, armor: 40, regen: 5, critRating: 30 });
    f.seed("playerResearch", { ...createEmptyResearchRanks(), identity: f.ctx.sender, warcraft: 10, criticalChance: 12, criticalDamage: 4 });
    f.seed("playerPrestigePerk", { identity: f.ctx.sender, keenEdge: 3 });
    setActiveCards(f.ctx, f.ctx.sender, ["frost_striker_card"]);
    // Warcraft switched off: the bound keeps the stored rank, power must not.
    f.seed("playerBonusToggle", { identity: f.ctx.sender, off: "research.warcraft" });
    const { combatBoundForReport } = createCombatReport({ attackIntervalForProgress, itemUpgradeLevelFor: itemLevelFor, inventoryForProgress,
      equippedRightHandForProgress, equippedLeftHandForProgress, equippedHeadForProgress, equippedChestForProgress });
    const report = combatBoundForReport(f.ctx as any);
    const saved = readPlayerProgress(f.ctx, f.ctx.sender);
    expect(report.powerFields(saved)).toEqual(powerFieldsForProgress(f.ctx, saved));
    // A crit kill raises the rating inside the report.
    const rewarded = { ...saved, damage: saved.damage + 7, critRating: saved.critRating + 40 };
    expect(report.powerFields(rewarded)).toEqual(powerFieldsForProgress(f.ctx, rewarded));
  });
});

describe("guild battle fighters", () => {
  const runtime = createDuelRuntime({
    requireControllingPlayer: () => null, isSupportedProtocol: () => true, sameIdentity: (a, b) => a.isEqual(b), playersBlocked: () => false,
    isVirtualPlayer: () => false, insertChatMessage: () => null, researchedDamage, researchedArmor, researchedRegen, maxHealthForProgress,
    attackIntervalForProgress, equippedRightHandForProgress, equippedLeftHandForProgress, equipmentPresentationForProgress,
  });

  it("fight with a duel's staff casts, bolt damage and Mastery fold", () => {
    const f = crystalFixture(), opponent = identity("b");
    holding(f, "ion_staff");
    f.patch("playerProgress", { damage: 10, maxHp: 10_000, regen: 2, attackRate: 1 });
    train(f, "sorcery", 40);
    f.progress(opponent, { damage: 10, maxHp: 10_000 });
    holding(f, "starter_bow", opponent);
    f.seed("playerProfile", { identity: opponent, displayName: "Opponent" });
    f.seed("player", { ...f.db.player.identity.find(f.ctx.sender), identity: opponent });
    const fighter = runtime.guildFighter(f.ctx, f.ctx.sender, readPlayerProgress(f.ctx, f.ctx.sender));
    f.run(server.requestDuel, { opponent });
    const duel = [...f.db.duel.iter()][0];
    // Against a plain bow nothing in the duel depends on the opponent, so the fighter is the duel's side.
    expect(fighter.damage).toBeCloseTo(duel.challengerDamage, 9);
    expect(fighter.attackRate).toBeCloseTo(duel.challengerAttackRate, 9);
    expect(fighter.attackRate).toBeCloseTo(weaponAttackInterval("ion_staff", 1), 9);
    // Mana Shield as the health a knockout has to get through.
    const shield = .5 + .5 / (1 - MANA_SHIELD_REDUCTION);
    expect(fighter.maxHp).toBeCloseTo(duel.challengerMaxHp * shield, 6);
    expect(fighter.regen).toBeCloseTo(duel.challengerRegen * shield, 9);
  });
});
