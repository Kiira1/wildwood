import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { prestigePerkRanks, statRewardMultiplier, storedPrestigePerkRanks, writePrestigePerkRanks } from "./prestige";
import { prestigeRangeBonus, savedAttackRange } from "./player-speed";
import { researchInPlay } from "./bonus-toggles";
import { soulStatsFor, soulAttackCapFor } from "./soul-dimension";
import { reflectRewardsInPlay } from "./prestige-challenge";
import { PRESTIGE_PERK_IDS, playerAttackCap } from "../../shared/prestige-perks";
import { attackSpeedRatingForInterval, attackIntervalForRating } from "../../shared/stat-rating";
import { BONUS_ITEM_IDS } from "../../shared/bonus-toggles";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const ALL_ON = { off: "" };
const EVERYTHING_OFF = { off: BONUS_ITEM_IDS.join(",") };

function fixture() {
  const f = crystalFixture();
  f.seed("playerPrestige", { identity: f.ctx.sender, level: 3, perkPoints: 0, peakPower: 0, prestigedAt: f.ctx.timestamp });
  writePrestigePerkRanks(f.ctx, f.ctx.sender, { keenEdge: 2, doubleStrike: 1, splitShot: 0, riposte: 1, bossSlayer: 0, secondWind: 0, longShot: 4, fleetFoot: 3, quickDraw: 5, weaponCards: 0, helmetCards: 0, armorCards: 0 });
  f.seed("playerPrestigeChallenge", { identity: f.ctx.sender, active: false, completed: 2 });
  f.seed("playerSoulStats", { identity: f.ctx.sender, damage: 50, maxHp: 80, armor: 10, regen: 1, attackSpeed: 0, critDamage: 0 });
  const research = f.db.playerResearch.identity.find(f.ctx.sender);
  if (research) f.db.playerResearch.identity.update({ ...research, warcraft: 10, utilityAttackRange: 3 });
  else f.seed("playerResearch", { identity: f.ctx.sender, warcraft: 10, utilityAttackRange: 3 });
  return f;
}
const zero = Object.fromEntries(PRESTIGE_PERK_IDS.map(perk => [perk, 0]));

it("plays without everything switched off, and brings it all back when switched on", () => {
  const f = fixture();
  const ranks = prestigePerkRanks(f.ctx, f.ctx.sender), multiplier = statRewardMultiplier(f.ctx, f.ctx.sender);
  const range = savedAttackRange(f.ctx, f.ctx.sender);
  expect(ranks.longShot).toBe(4);
  expect(soulStatsFor(f.ctx, f.ctx.sender)).toMatchObject({ damage: 50 });
  expect(reflectRewardsInPlay(f.ctx, f.ctx.sender)).toMatchObject({ completed: 2 });

  f.run(server.setBonusToggleState, EVERYTHING_OFF);
  expect(prestigePerkRanks(f.ctx, f.ctx.sender)).toEqual(zero);
  expect(storedPrestigePerkRanks(f.ctx, f.ctx.sender)).toEqual(ranks);
  expect(prestigeRangeBonus(f.ctx, f.ctx.sender)).toBe(0);
  expect(statRewardMultiplier(f.ctx, f.ctx.sender)).toBeLessThan(multiplier);
  expect(researchInPlay(f.ctx, f.ctx.sender)).toMatchObject({ warcraft: 0, utilityAttackRange: 0 });
  expect(soulStatsFor(f.ctx, f.ctx.sender)).toMatchObject({ damage: 0, maxHp: 0, armor: 0 });
  expect(reflectRewardsInPlay(f.ctx, f.ctx.sender)).toBeNull();
  expect(soulAttackCapFor(f.ctx, f.ctx.sender)).toEqual(playerAttackCap(null, zero));
  // The saved range leaves out range research and Long Shot.
  expect(progressOf(f, f.ctx.sender).attackRange).toBeLessThan(range);

  f.run(server.setBonusToggleState, ALL_ON);
  expect(f.db.playerBonusToggle.identity.find(f.ctx.sender)).toBeFalsy();
  expect(prestigePerkRanks(f.ctx, f.ctx.sender)).toEqual(ranks);
  expect(statRewardMultiplier(f.ctx, f.ctx.sender)).toBeCloseTo(multiplier);
  expect(progressOf(f, f.ctx.sender).attackRange).toBe(range);
  expect(soulStatsFor(f.ctx, f.ctx.sender)).toMatchObject({ damage: 50 });
});

it("keeps the run's attack speed rating when the cap moves under it, and gives the attack speed back", () => {
  const f = fixture();
  const capOn = playerAttackCap(reflectRewardsInPlay(f.ctx, f.ctx.sender), prestigePerkRanks(f.ctx, f.ctx.sender));
  const interval = attackIntervalForRating(5_000, capOn);
  f.patch("playerProgress", { attackRate: interval });
  f.run(server.setBonusToggleState, { off: "prestige.quickDraw,challenge.reflect" });
  const capOff = playerAttackCap(null, { ...prestigePerkRanks(f.ctx, f.ctx.sender), quickDraw: 0 });
  const off = progressOf(f, f.ctx.sender).attackRate;
  expect(attackSpeedRatingForInterval(off, capOff)).toBeCloseTo(attackSpeedRatingForInterval(interval, capOn), 3);
  f.run(server.setBonusToggleState, ALL_ON);
  expect(progressOf(f, f.ctx.sender).attackRate).toBeCloseTo(interval, 9);
});

it("can't switch during a challenge", () => {
  const f = fixture();
  f.patch("playerPrestigeChallenge", { active: true });
  expect(() => f.run(server.setBonusToggleState, { off: "soul.damage" })).toThrow("challenge");
});

it("switches single bonuses: only Keen Edge, only Warcraft, only soul Damage", () => {
  const f = fixture();
  const ranks = prestigePerkRanks(f.ctx, f.ctx.sender);
  f.run(server.setBonusToggleState, { off: "prestige.keenEdge,research.warcraft,soul.damage,bogus.id" });
  expect(f.db.playerBonusToggle.identity.find(f.ctx.sender)).toMatchObject({ off: "prestige.keenEdge,research.warcraft,soul.damage" });
  expect(prestigePerkRanks(f.ctx, f.ctx.sender)).toEqual({ ...ranks, keenEdge: 0 });
  expect(researchInPlay(f.ctx, f.ctx.sender)).toMatchObject({ warcraft: 0, utilityAttackRange: 3 });
  expect(soulStatsFor(f.ctx, f.ctx.sender)).toMatchObject({ damage: 0, maxHp: 80 });
  // Stat gain and Reflect Only's cap stay on.
  expect(reflectRewardsInPlay(f.ctx, f.ctx.sender)).toMatchObject({ completed: 2 });
});
