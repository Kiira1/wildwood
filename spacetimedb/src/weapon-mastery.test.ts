import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { fillDefeatBudget, reportEnemy, reportKills } from "../../tests/helpers/enemy-defeat";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
import { IRON_BOW, WOODEN_SWORD } from "../../shared/items";
import { backfillMasteryLevels, mergeWeaponMastery, weaponMasteryPoints } from "./weapon-mastery";
import { MASTERY_FIRST_LEVEL_POINTS } from "../../shared/weapon-mastery";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const points = (f: any, who = f.ctx.sender) => weaponMasteryPoints(f.ctx, who);
const holding = (f: any, itemId: string) => f.patch("playerProgress", { inventoryJson: JSON.stringify([itemId]), equippedRightHand: itemId });
/** Kills the server accepts: strong enough, and the camp's budget full. */
function fighter() {
  const f = crystalFixture();
  f.patch("playerProgress", { damage: 1e15 });
  fillDefeatBudget(f, "crystal_hollows", "Shard Hopper");
  return f;
}
const kill = (f: any, count: number) => reportEnemy(f, "Shard Hopper", count);
const clearBoss = (f: any, sequence: bigint) =>
  reportKills(f, { streamId: "mastery-boss-stream-01", sequence, mapId: "crystal_hollows", enemies: [{ enemy: "boss", count: 1 }] });

describe("weapon mastery points", () => {
  it("gives the school of the weapon in hand a point a kill", () => {
    const f = fighter();
    holding(f, IRON_BOW);
    kill(f, 3);
    expect(points(f)).toEqual({ archery: 3n, swordplay: 0n, sorcery: 0n });
    holding(f, WOODEN_SWORD);
    kill(f, 2);
    expect(points(f)).toEqual({ archery: 3n, swordplay: 2n, sorcery: 0n });
  });

  it("gives 50 for a boss's first clear in a run, and nothing for a repeat claim", () => {
    const f = crystalFixture();
    holding(f, IRON_BOW);
    clearBoss(f, 1n);
    expect(points(f).archery).toBe(50n);
    clearBoss(f, 2n);
    expect(points(f).archery).toBe(50n);
  });

  it("trains nothing during Reflect Only, where Reflect does the killing", () => {
    const f = fighter();
    f.seed("playerPrestigeChallenge", { identity: f.ctx.sender, active: true, completed: 0 });
    kill(f, 3);
    expect(points(f)).toEqual({ archery: 0n, swordplay: 0n, sorcery: 0n });
  });

  it("is kept through prestige and cleared by Reset Save", () => {
    const f = fighter();
    holding(f, IRON_BOW);
    kill(f, 4);
    f.seed("playerPrestige", { identity: f.ctx.sender, level: 1, perkPoints: 0, peakPower: 0, prestigedAt: f.ctx.timestamp });
    f.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
    f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 12 });
    f.run(server.prestigeAccount);
    expect(f.db.playerPrestige.identity.find(f.ctx.sender).level).toBe(2);
    expect(points(f).archery).toBe(4n);
    f.run(server.resetPlayerProgress, {});
    expect([...f.db.playerWeaponMastery.identity.filter(f.ctx.sender)]).toEqual([]);
  });

  it("moves a guest's Mastery to the account on link, replacing the account's", () => {
    const f = fighter(), account = identity("5");
    holding(f, IRON_BOW);
    kill(f, 6);
    f.transaction(() => f.db.playerWeaponMastery.insert({ key: `${account.toHexString()}:swordplay`, identity: account, school: "swordplay", points: 99n }));
    f.transaction(() => mergeWeaponMastery(f.ctx, f.ctx.sender, account));
    expect(points(f, account)).toEqual({ archery: 6n, swordplay: 0n, sorcery: 0n });
    expect([...f.db.playerWeaponMastery.identity.filter(f.ctx.sender)]).toEqual([]);
  });

  it("copies each school's level to the public table once it reaches level 1, and backfills points earned before", () => {
    const f = fighter();
    holding(f, IRON_BOW);
    const levelRow = () => f.db.playerMasteryLevel.key.find(`${f.ctx.sender.toHexString()}:archery`);
    f.transaction(() => f.db.playerWeaponMastery.insert({ key: `${f.ctx.sender.toHexString()}:archery`, identity: f.ctx.sender, school: "archery", points: BigInt(MASTERY_FIRST_LEVEL_POINTS - 2) }));
    kill(f, 1);
    expect(levelRow()).toBeFalsy();
    kill(f, 1);
    expect(levelRow()).toMatchObject({ school: "archery", level: 1 });
    f.transaction(() => f.db.playerMasteryLevel.key.delete(levelRow().key));
    f.transaction(() => backfillMasteryLevels(f.ctx));
    expect(levelRow()).toMatchObject({ level: 1 });
    f.run(server.resetPlayerProgress, {});
    expect(levelRow()).toBeFalsy();
  });
});
