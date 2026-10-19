import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { fillDefeatBudget, reportKills } from "../../tests/helpers/enemy-defeat";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

/** On Crystal Hollows, strong, with its camp's budget full and a prestige ready. */
function readyToPrestige() {
  const f = crystalFixture();
  f.patch("playerProgress", { damage: 1e15, bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
  fillDefeatBudget(f, "crystal_hollows", "Shard Hopper");
  f.seed("playerPrestige", { identity: f.ctx.sender, level: 1, perkPoints: 0, peakPower: 0, prestigedAt: f.ctx.timestamp });
  f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 12 });
  // Soul stats outlive a prestige, so the fresh run can still clear the old map's enemies.
  f.seed("playerSoulStats", { identity: f.ctx.sender, damage: 1e15, maxHp: 1e15, armor: 0, regen: 0, attackSpeed: 0, critDamage: 0, kills: 0n });
  return f;
}
const lateKills = (f: any) => {
  try { reportKills(f, { streamId: "prestige-grace-stream-1", sequence: 1n, mapId: "crystal_hollows", enemies: [{ enemy: "Shard Hopper", count: 20 }] }); }
  catch { /* Refused outright is as good as unpaid. */ }
};

it("pays the fresh run nothing for kills still arriving from the map left by prestiging", () => {
  const f = readyToPrestige();
  f.run(server.prestigeAccount);
  const fresh = progressOf(f, f.ctx.sender);
  expect(f.db.player.identity.find(f.ctx.sender).mapId).toBe("tutorial_forest");
  lateKills(f);
  const after = progressOf(f, f.ctx.sender);
  expect(after.damage).toBe(fresh.damage);
  expect(after.maxHp).toBe(fresh.maxHp);
});

it("ends the old map's grace on prestige, so nothing more can be reported for it", () => {
  const f = readyToPrestige();
  f.run(server.prestigeAccount);
  expect(f.db.playerMapDeparture.identity.find(f.ctx.sender)).toBeFalsy();
});
