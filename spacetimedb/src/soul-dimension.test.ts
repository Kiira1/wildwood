import { describe, expect, it, vi } from "vitest";
import { Identity, Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { fillDefeatBudget, reportKills, seedDefeatClock } from "../../tests/helpers/enemy-defeat";
import { STARTER_BOW } from "../../shared/items";
import {
  addSoulKills, cleanSoulStats, soulAttackSpeedBonus, soulRewardMultiplier, soulTierKillsNeeded,
  SOUL_ARRIVAL, SOUL_LEVEL_BASE_XP, SOUL_LEVEL_CAP, SOUL_MAP_ID, SOUL_STAT_DETAILS, SOUL_STAT_ORDER, SOUL_TOWN_PORTAL,
} from "../../shared/soul-dimension";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
import { mergeSoulDimensionRows, removeSoulDimensionRows } from "./soul-dimension";
import { ERASURE_TARGETS } from "./account-erasure";
import { TOWN_ARRIVAL, TOWN_SOUL_PORTAL } from "../../shared/town";
import { HOME_TRAVEL_PORTAL } from "../../shared/home";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

function soulReady(options: { open?: boolean; prestige?: number; kills?: number } = {}) {
  const f = crystalFixture();
  f.patch("playerProgress", { equippedRightHand: STARTER_BOW, inventoryJson: '["starter_bow"]', damage: 1_000 });
  // No row is open; a row the developer switched off closes it.
  if (options.open === false) f.seed("soulDimensionConfig", { id: 0, open: false });
  if (options.prestige ?? 1) f.seed("playerPrestige", { identity: f.ctx.sender, level: options.prestige ?? 1, perkPoints: 0, peakPower: 0, prestigedAt: new Timestamp(0n) });
  const kills = BigInt(options.kills ?? 25);
  f.seed("playerRewardKills", { identity: f.ctx.sender, damage: kills, health: kills, armor: kills, regen: kills, speed: kills });
  return f;
}
const soulKills = (f: any, enemies: { enemy: string; count: number }[], sequence = 1n) => {
  f.patch("player", { mapId: SOUL_MAP_ID, x: SOUL_ARRIVAL.x, y: SOUL_ARRIVAL.y });
  if (sequence === 1n) for (const { enemy } of enemies) fillDefeatBudget(f, SOUL_MAP_ID, enemy);
  return reportKills(f, { streamId: "soul-stream-000001", sequence, mapId: SOUL_MAP_ID, enemies });
};

it("counts campaign kills by reward type, for everyone, Soul Dimension open or not", () => {
  const f = crystalFixture();
  f.patch("player", { mapId: "tutorial_forest" });
  f.patch("playerProgress", { equippedRightHand: STARTER_BOW, inventoryJson: '["starter_bow"]', damage: 1_000 });
  fillDefeatBudget(f, "tutorial_forest", "Spitter");
  fillDefeatBudget(f, "tutorial_forest", "Bramble");
  reportKills(f, { streamId: "forest-stream-00001", sequence: 1n, mapId: "tutorial_forest", enemies: [{ enemy: "Spitter", count: 4 }, { enemy: "Bramble", count: 2 }] });
  const row = f.db.playerRewardKills.identity.find(f.ctx.sender);
  expect(row.damage).toBe(4n);
  expect(row.health).toBe(2n);
  expect(row.armor).toBe(0n);
});

it("pays soul stats for the soul enemies a tier has woken, and nothing for the rest", () => {
  const f = soulReady({ kills: 25 });
  soulKills(f, [{ enemy: "soul:damage", count: 5 }, { enemy: "soul:health", count: 3 }]);
  const soul = f.db.playerSoulStats.identity.find(f.ctx.sender);
  expect(soul.damage).toBe(5);
  expect(soul.maxHp).toBe(0);
  expect(soul.kills).toBe(5n);
});

it("pays a Reflect build's soul kills, whose enemies are built from its weapon damage alone", () => {
  // High health, armor and Riposte, next to no weapon damage: the client builds each soul enemy
  // from the weapon (soulEnemyStats), so Reflect kills them almost at once. The bound used to size
  // them by weapon plus reflect damage, and with the combat bank spent paid 9 of these 100.
  const run = (riposte: number) => {
    const f = soulReady({ kills: 25 });
    f.patch("playerProgress", { damage: 1, maxHp: 1_000_000, armor: 100_000 });
    if (riposte) f.seed("playerPrestigePerk", { identity: f.ctx.sender, riposte });
    f.patch("player", { mapId: SOUL_MAP_ID, x: SOUL_ARRIVAL.x, y: SOUL_ARRIVAL.y });
    fillDefeatBudget(f, SOUL_MAP_ID, "soul:damage");
    seedDefeatClock(f, "combat", 0);
    reportKills(f, { streamId: "soul-stream-000001", sequence: 1n, mapId: SOUL_MAP_ID, simulatedMillis: 10_000, enemies: [{ enemy: "soul:damage", count: 100 }] });
    return f.db.playerSoulStats.identity.find(f.ctx.sender)?.damage ?? 0;
  };
  expect(run(5)).toBe(100);
  // Without Reflect the same weak weapon is still held to what it could kill.
  expect(run(0)).toBeLessThan(20);
});

it("adds up across reports: the reward is flat and never grows", () => {
  const f = soulReady({ kills: 125 });
  soulKills(f, [{ enemy: "soul:health", count: 10 }]);
  expect(f.db.playerSoulStats.identity.find(f.ctx.sender).maxHp).toBe(10);
  soulKills(f, [{ enemy: "soul:health", count: 10 }], 2n);
  expect(f.db.playerSoulStats.identity.find(f.ctx.sender).maxHp).toBe(20);
});

it("pays nothing in a Soul Dimension that is closed to the player", () => {
  const f = soulReady({ open: false });
  soulKills(f, [{ enemy: "soul:damage", count: 5 }]);
  expect(f.db.playerSoulStats.identity.find(f.ctx.sender)).toBeFalsy();
});

const portalSpot = (portal: { x: number; y: number; height: number }) => ({ x: portal.x, y: portal.y - portal.height * .32 });

it("refuses the way in to a player who has never prestiged", () => {
  const f = soulReady({ prestige: 0 });
  const at = portalSpot(TOWN_SOUL_PORTAL);
  f.patch("player", { mapId: "town", ...at });
  expect(() => f.run(server.changeMap, { mapId: SOUL_MAP_ID, ...at })).toThrow(/not open to you/);
});

it("goes in from the Town's bottom road, and back to the Town through the forest's portal", () => {
  const f = soulReady();
  const at = portalSpot(TOWN_SOUL_PORTAL);
  f.patch("player", { mapId: "town", ...at });
  f.run(server.changeMap, { mapId: SOUL_MAP_ID, ...at });
  expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: SOUL_MAP_ID, x: SOUL_ARRIVAL.x, y: SOUL_ARRIVAL.y });
  const back = portalSpot(SOUL_TOWN_PORTAL);
  f.patch("player", back);
  f.run(server.changeMap, { mapId: "town", ...back });
  expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "town", x: TOWN_ARRIVAL.x, y: TOWN_ARRIVAL.y });
  // Home is no longer a way in, not even its pad.
  const pad = portalSpot(HOME_TRAVEL_PORTAL);
  f.patch("player", { mapId: "home_exterior", ...pad });
  expect(() => f.run(server.changeMap, { mapId: SOUL_MAP_ID, ...pad })).toThrow(/not connected/);
});

it("is where Fight goes back to in the main run, never in a challenge run, whose start is the forest", () => {
  const f = soulReady();
  const me = () => f.db.player.identity.find(f.ctx.sender);
  // Base from the Soul Dimension keeps the spot, and Fight goes back to it.
  f.patch("player", { mapId: SOUL_MAP_ID, ...SOUL_ARRIVAL });
  f.run(server.changeMap, { mapId: "town", ...SOUL_ARRIVAL });
  expect(me().mapId).toBe("town");
  f.run(server.changeMap, { mapId: "town", ...TOWN_ARRIVAL });
  expect(me()).toMatchObject({ mapId: SOUL_MAP_ID, x: SOUL_ARRIVAL.x, y: SOUL_ARRIVAL.y });
  f.run(server.changeMap, { mapId: "town", ...SOUL_ARRIVAL });
  for (const [start, end] of [[server.startAggroRun, server.abandonAggroRun], [server.startPrestigeChallenge, server.abandonPrestigeChallenge]]) {
    f.run(start);
    // In the Town in the challenge run (a parked run resumed there): Fight starts the run where a fresh one does.
    f.patch("player", { mapId: "town", ...TOWN_ARRIVAL });
    f.run(server.changeMap, { mapId: "town", ...TOWN_ARRIVAL });
    expect(me().mapId).toBe("tutorial_forest");
    expect(f.db.homeReturnLocation.identity.find(f.ctx.sender).mapId).toBe(SOUL_MAP_ID);
    // Back in the main run (in the Town, where it was left), Fight goes to the Soul Dimension again.
    f.run(end);
    expect(me().mapId).toBe("town");
    f.run(server.changeMap, { mapId: "town", ...TOWN_ARRIVAL });
    expect(me().mapId).toBe(SOUL_MAP_ID);
    f.run(server.changeMap, { mapId: "town", ...SOUL_ARRIVAL });
  }
});

it("shows every player's soul stats to profiles, through an anonymous view that needs no sender", () => {
  const f = soulReady({ kills: 25 });
  soulKills(f, [{ enemy: "soul:damage", count: 5 }]);
  const other = new Identity(2n);
  f.seed("playerSoulStats", { identity: other, damage: 0, maxHp: 12, armor: 3, regen: 0, attackSpeed: 0, critDamage: .2, kills: 13n });
  const rows = server.profileSoulStats({ db: f.db } as never) as any[];
  expect(rows).toHaveLength(2);
  expect(rows.find(row => row.identity.isEqual(f.ctx.sender))).toMatchObject({ damage: 5, kills: 5n });
  expect(rows.find(row => row.identity.isEqual(other))).toMatchObject({ maxHp: 12, armor: 3, critDamage: .2, kills: 13n });
  // The owner's own view is unchanged: one row, theirs.
  expect(server.mySoulStats(f.ctx)).toEqual([f.db.playerSoulStats.identity.find(f.ctx.sender)]);
});

describe("the Soul Level", () => {
  const levelOf = (f: any) => f.db.playerSoulLevel.identity.find(f.ctx.sender);
  const seedLevel = (f: any, level: number, xp = 0) => f.seed("playerSoulLevel", { identity: f.ctx.sender, level, xp: BigInt(xp) });

  it("gives 1 Soul XP a soul kill, and none for campaign kills", () => {
    const f = soulReady({ kills: 125 });
    f.patch("player", { mapId: "tutorial_forest" });
    fillDefeatBudget(f, "tutorial_forest", "Spitter");
    reportKills(f, { streamId: "forest-stream-00001", sequence: 1n, mapId: "tutorial_forest", enemies: [{ enemy: "Spitter", count: 4 }] });
    expect(levelOf(f)).toBeFalsy();
    soulKills(f, [{ enemy: "soul:damage", count: 5 }, { enemy: "soul:health", count: 3 }], 1n);
    expect(levelOf(f)).toMatchObject({ level: 1, xp: 8n });
  });

  it("gives no Soul XP for soul enemies the tier has not woken", () => {
    const f = soulReady({ kills: 25 });
    soulKills(f, [{ enemy: "soul:health", count: 5 }]);
    expect(levelOf(f)).toBeFalsy();
  });

  it("doubles every soul reward each level, the rating ones too", () => {
    const run = (level: number) => {
      const f = soulReady({ kills: soulTierKillsNeeded(6) });
      if (level > 1) seedLevel(f, level);
      soulKills(f, SOUL_STAT_ORDER.map(stat => ({ enemy: `soul:${stat}`, count: 2 })));
      return f.db.playerSoulStats.identity.find(f.ctx.sender);
    };
    for (const level of [1, 2, 3, 5]) {
      const multiplier = soulRewardMultiplier(level);
      expect(multiplier).toBe(2 ** (level - 1));
      const expected = SOUL_STAT_ORDER.reduce((soul, stat) => addSoulKills(soul, stat, 2 * multiplier), cleanSoulStats(null));
      const row = run(level);
      for (const key of ["damage", "maxHp", "armor", "regen", "attackSpeed", "critDamage"] as const) expect(row[key], `${key} at ${level}`).toBeCloseTo(expected[key], 9);
      expect(row.damage).toBe(2 * multiplier);
      expect(soulAttackSpeedBonus(row.attackSpeed)).toBeCloseTo(2 * multiplier * SOUL_STAT_DETAILS.attackSpeed.reward, 9);
      expect(row.kills).toBe(12n);
    }
  });

  it("pays a whole report at the level it started at, and levels up after it", () => {
    const f = soulReady({ kills: 25 });
    seedLevel(f, 1, SOUL_LEVEL_BASE_XP - 10);
    soulKills(f, [{ enemy: "soul:damage", count: 30 }]);
    expect(f.db.playerSoulStats.identity.find(f.ctx.sender).damage).toBe(30);
    expect(levelOf(f)).toMatchObject({ level: 2, xp: 20n });
    soulKills(f, [{ enemy: "soul:damage", count: 10 }], 2n);
    expect(f.db.playerSoulStats.identity.find(f.ctx.sender).damage).toBe(30 + 20);
    expect(levelOf(f)).toMatchObject({ level: 2, xp: 30n });
  });

  it("stops at the cap: rewards stay at its multiplier and the row is no longer written", () => {
    const f = soulReady({ kills: 25 });
    seedLevel(f, SOUL_LEVEL_CAP);
    const update = vi.spyOn(f.db.playerSoulLevel.identity, "update");
    soulKills(f, [{ enemy: "soul:damage", count: 3 }]);
    expect(f.db.playerSoulStats.identity.find(f.ctx.sender).damage).toBe(3 * 2 ** (SOUL_LEVEL_CAP - 1));
    expect(levelOf(f)).toMatchObject({ level: SOUL_LEVEL_CAP, xp: 0n });
    expect(update).not.toHaveBeenCalled();
  });

  it("reads and writes its row at most once a soul report, and never on a campaign report", () => {
    const count = (f: any, run: () => void) => {
      const table = f.db.playerSoulLevel;
      const find = vi.spyOn(table.identity, "find"), update = vi.spyOn(table.identity, "update"), insert = vi.spyOn(table, "insert");
      run();
      const calls = { reads: find.mock.calls.length, writes: update.mock.calls.length + insert.mock.calls.length };
      find.mockRestore(); update.mockRestore(); insert.mockRestore();
      return calls;
    };
    const soul = soulReady({ kills: 125 });
    expect(count(soul, () => soulKills(soul, [{ enemy: "soul:damage", count: 5 }, { enemy: "soul:health", count: 5 }]))).toEqual({ reads: 1, writes: 1 });
    expect(count(soul, () => soulKills(soul, [{ enemy: "soul:damage", count: 5 }], 2n))).toEqual({ reads: 1, writes: 1 });
    const forest = soulReady({ kills: 125 });
    forest.patch("player", { mapId: "tutorial_forest" });
    fillDefeatBudget(forest, "tutorial_forest", "Spitter");
    expect(count(forest, () => reportKills(forest, { streamId: "forest-stream-00001", sequence: 1n, mapId: "tutorial_forest", enemies: [{ enemy: "Spitter", count: 4 }] })))
      .toEqual({ reads: 0, writes: 0 });
  });

  it("is kept through a prestige, like the soul stats", () => {
    const f = soulReady();
    seedLevel(f, 4, 123);
    f.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
    f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 4 });
    f.run(server.prestigeAccount, {});
    expect(f.db.playerPrestige.identity.find(f.ctx.sender).level).toBe(2);
    expect(levelOf(f)).toMatchObject({ level: 4, xp: 123n });
  });

  it("goes with the rest of the soul on Reset Save and on erasure", () => {
    const f = soulReady();
    seedLevel(f, 3, 5);
    f.run(server.resetPlayerProgress, {});
    expect(levelOf(f)).toBeFalsy();
    const g = soulReady();
    seedLevel(g, 3, 5);
    g.run((ctx: any) => removeSoulDimensionRows(ctx, ctx.sender), {});
    expect(levelOf(g)).toBeFalsy();
    expect(ERASURE_TARGETS.some(entry => entry.table === "playerSoulLevel")).toBe(true);
  });

  it("adds a guest's Soul XP onto the account it links to", () => {
    const f = soulReady();
    const guest = identity("7");
    seedLevel(f, 2, 100);
    f.seed("playerSoulLevel", { identity: guest, level: 1, xp: 250n });
    f.run((ctx: any) => mergeSoulDimensionRows(ctx, guest, ctx.sender), {});
    // 300 + 100 + 250 Soul XP: level 2 with 350 toward level 3.
    expect(levelOf(f)).toMatchObject({ level: 2, xp: 350n });
    expect(f.db.playerSoulLevel.identity.find(guest)).toBeFalsy();
    const fresh = soulReady();
    fresh.seed("playerSoulLevel", { identity: guest, level: 3, xp: 7n });
    fresh.run((ctx: any) => mergeSoulDimensionRows(ctx, guest, ctx.sender), {});
    expect(levelOf(fresh)).toMatchObject({ level: 3, xp: 7n });
  });
});
