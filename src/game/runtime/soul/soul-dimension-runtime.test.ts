import { describe, expect, it, vi } from "vitest";
vi.mock("../../../app/developer", () => ({ isDeveloperIdentity: () => false }));
import { SOUL_CAMPS, SOUL_MAP_ID, SOUL_POPULATION, soulTierKillsNeeded } from "../../../../shared/soul-dimension";
import { TOWN_SOUL_PORTAL } from "../../../../shared/town";
import { soulStatOfCampName } from "../../soul-world";
import type { MapId, SpawnSite } from "../../world";
import { createSoulDimensionRuntime } from "./soul-dimension-runtime";
import type { EnemyState, PlayerState } from "../types";
import { critDamageForLevels, ratingLevels } from "../../../../shared/stat-rating";
import { SOUL_STAT_DETAILS, soulAttackSpeedBonus, soulAttackSpeedRatingAfterKills } from "../../../../shared/soul-dimension";
import { addSoulKills, addSoulXp, cleanSoulStats, soulRewardMultiplier, SOUL_LEVEL_CAP, type SoulLevel, type SoulStatId, type SoulStats } from "../../../../shared/soul-dimension";
import { soulRewardText } from "../../soul-world";

function dimension(options: { kills?: number; prestige?: number; map?: MapId } = {}) {
  const player = { x: 0, y: 0, r: 16, hp: 100, maxHp: 100, moving: false, facing: 0 } as unknown as PlayerState;
  const kills = options.kills ?? 0, spawnSites: SpawnSite[] = [], enemies: EnemyState[] = [];
  const town: { secondaryPortal?: unknown } = {};
  let map: MapId = options.map ?? SOUL_MAP_ID;
  const spawned: SpawnSite[] = [];
  const runtime = createSoulDimensionRuntime({
    source: () => ({ soulDimensionOpen: () => true, prestige: () => ({ level: options.prestige ?? 1 }),
      rewardKills: () => ({ damage: kills, health: kills, armor: kills, regen: kills, speed: kills }) }),
    player, enemies, spawnSites, currentMapId: () => map, spawnFromSite: site => spawned.push(site), townMap: town as never,
    strength: () => ({ dps: 10, maxHp: 100, armor: 0, regen: 0 }),
  });
  return { runtime, spawnSites, spawned, town, goTo: (next: MapId) => { map = next; } };
}

it("leaves the forest empty before the first tier", () => {
  const d = dimension();
  d.runtime.update(1 / 60);
  expect(d.spawnSites).toHaveLength(0);
});

it("fills every forest camp with one soul stat's enemies, as many as the forest holds", () => {
  const d = dimension({ kills: soulTierKillsNeeded(1) });
  d.runtime.update(1 / 60);
  expect(d.spawnSites).toHaveLength(SOUL_POPULATION);
  expect(d.spawned).toHaveLength(SOUL_POPULATION);
  expect(new Set(d.spawnSites.map(site => soulStatOfCampName(site.campName)))).toEqual(new Set(["damage"]));
  expect(new Set(d.spawnSites.map(site => site.type))).toEqual(new Set(["Spitter"]));
});

it("mixes the stats a higher tier has woken across the camps", () => {
  const d = dimension({ kills: soulTierKillsNeeded(3) });
  d.runtime.update(1 / 60);
  const stats = new Set(d.spawnSites.map(site => soulStatOfCampName(site.campName)));
  expect(stats).toEqual(new Set(["damage", "health", "armor"]));
  expect(SOUL_CAMPS.length).toBeGreaterThan(3);
});

it("stands the Town's portal in only for a player who may go through it", () => {
  const open = dimension({ map: "town" });
  open.runtime.update(1 / 60);
  expect(open.town.secondaryPortal).toMatchObject({ x: TOWN_SOUL_PORTAL.x, y: TOWN_SOUL_PORTAL.y, destination: SOUL_MAP_ID });
  const locked = dimension({ map: "town", prestige: 0 });
  locked.runtime.update(1 / 60);
  expect(locked.town.secondaryPortal).toBeUndefined();
});

it("adds the soul stats once, however many saves and loads go round, and none during a challenge", async () => {
  const { mergeProgress } = await import("../../../coop/services/progress");
  let aggro = false;
  const soul = { damage: 100, maxHp: 1_000, armor: 50, regen: 5, attackSpeed: .5, critDamage: .1 };
  const runtime = createSoulDimensionRuntime({
    source: () => ({ soulStats: () => soul, aggroChallenge: () => ({ active: aggro }) }),
    player: { x: 0, y: 0 } as never, enemies: [], spawnSites: [], currentMapId: () => "tutorial_forest", spawnFromSite: () => {}, townMap: {},
    strength: () => ({ dps: 10, maxHp: 100, armor: 0, regen: 0 }),
  });
  const saved = { damage: 50, maxHp: 500, armor: 10, regen: 1, attackRate: 1, projectileSpeed: 0, projectileCount: 1, speed: 0, bootsCollected: false,
    inventoryJson: "[]", equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: "", equippedLeftHand: "" } as never as Parameters<typeof mergeProgress>[0];
  let pending: Parameters<typeof mergeProgress>[1] | null = null;
  let playing = runtime.withSoul(saved)!;
  // Each kill saves what the player plays with; each server row reload merges that save back in.
  for (let kill = 0; kill < 5; kill++) {
    pending = runtime.withoutSoul({ ...playing, maxHp: playing.maxHp + 1 }, saved.attackRate) as never;
    playing = runtime.withSoul(mergeProgress(saved, pending!))!;
  }
  expect(playing.damage).toBe(150);
  expect(playing.armor).toBe(60);
  expect(playing.regen).toBe(6);
  expect(playing.maxHp).toBe(1_505);
  // Soul attack speed adds its attacks a second flat on top of the run's (soulAttackSpeedBonus), once.
  expect(1 / playing.attackRate).toBeCloseTo(1 + soulAttackSpeedBonus(.5), 9);
  // A challenge plays from its own start: no soul stats at all.
  aggro = true;
  expect(runtime.withSoul(saved)).toMatchObject({ damage: 50, maxHp: 500, armor: 10, regen: 1, attackRate: 1 });
  expect(runtime.critDamage()).toBe(0);
});

it("counts soul crit damage up 0.002x a kill, as before 0.901.47, and never past 100×", () => {
  const soul = { damage: 0, maxHp: 0, armor: 0, regen: 0, attackSpeed: 0, critDamage: 98.9 };
  const runtime = createSoulDimensionRuntime({
    source: () => ({ soulStats: () => soul }),
    player: { x: 0, y: 0 } as never, enemies: [], spawnSites: [], currentMapId: () => "tutorial_forest", spawnFromSite: () => {}, townMap: {},
    strength: () => ({ dps: 10, maxHp: 100, armor: 0, regen: 0 }),
  });
  expect(runtime.critDamage()).toBeCloseTo(98.9);
  const multiplier = (rating: number) => critDamageForLevels(ratingLevels(rating));
  const before = multiplier(runtime.critDamage());
  for (let kill = 0; kill < 100; kill++) runtime.soulKill("critDamage");
  expect(multiplier(runtime.critDamage())).toBeCloseTo(before + .2, 6);
});

describe("soul kills the server has not counted yet", () => {
  function counting() {
    let soul = { damage: 0, maxHp: 0, armor: 0, regen: 0, attackSpeed: 0, critDamage: 0 };
    const player = { x: 0, y: 0, r: 16, hp: 100, maxHp: 100, moving: false, facing: 0 } as unknown as PlayerState;
    const runtime = createSoulDimensionRuntime({
      source: () => ({ soulDimensionOpen: () => true, prestige: () => ({ level: 1 }), soulStats: () => soul,
        rewardKills: () => ({ damage: 0, health: 0, armor: 0, regen: 0, speed: 0 }) }),
      player, enemies: [], spawnSites: [], currentMapId: () => SOUL_MAP_ID, spawnFromSite: () => {}, townMap: {} as never,
      strength: () => ({ dps: 10, maxHp: 100, armor: 0, regen: 0 }),
    });
    return { runtime, serverCounts: (speedKills: number, damage: number) => { soul = { ...soul, attackSpeed: soulAttackSpeedRatingAfterKills(0, speedKills), damage }; } };
  }

  it("keeps them when the server's row moves, so attack speed rises steadily instead of jumping back", () => {
    const c = counting();
    c.runtime.inPlay();
    c.runtime.soulKill("attackSpeed"); c.runtime.soulKill("attackSpeed"); c.runtime.soulKill("damage");
    expect(soulAttackSpeedBonus(c.runtime.inPlay().attackSpeed)).toBeCloseTo(.002, 9);
    // The server has counted one speed kill so far: the second is still on its way.
    c.serverCounts(1, 0);
    expect(soulAttackSpeedBonus(c.runtime.inPlay().attackSpeed)).toBeCloseTo(.002, 9);
    expect(c.runtime.inPlay().damage).toBe(SOUL_STAT_DETAILS.damage.reward);
    c.serverCounts(2, SOUL_STAT_DETAILS.damage.reward);
    expect(soulAttackSpeedBonus(c.runtime.inPlay().attackSpeed)).toBeCloseTo(.002, 9);
    expect(c.runtime.inPlay().damage).toBe(SOUL_STAT_DETAILS.damage.reward);
  });

  it("drops kills the server never counts once their reports have had time to come back", () => {
    vi.useFakeTimers();
    try {
      const c = counting();
      c.runtime.inPlay();
      c.runtime.soulKill("attackSpeed");
      expect(soulAttackSpeedBonus(c.runtime.inPlay().attackSpeed)).toBeCloseTo(.001, 9);
      vi.advanceTimersByTime(16_000);
      expect(soulAttackSpeedBonus(c.runtime.inPlay().attackSpeed)).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe("the Soul Level on the client", () => {
  function leveled(start: SoulLevel | null) {
    let soul: SoulStats | null = null, level = start;
    const logged: string[] = [], levelUps: [number, number][] = [];
    const runtime = createSoulDimensionRuntime({
      source: () => ({ soulDimensionOpen: () => true, prestige: () => ({ level: 1 }), soulStats: () => soul, soulLevel: () => level,
        rewardKills: () => ({ damage: 0, health: 0, armor: 0, regen: 0, speed: 0 }) }),
      player: { x: 0, y: 0 } as never, enemies: [], spawnSites: [], currentMapId: () => SOUL_MAP_ID, spawnFromSite: () => {}, townMap: {} as never,
      strength: () => ({ dps: 10, maxHp: 100, armor: 0, regen: 0 }), logPickup: text => logged.push(text),
      levelUp: (next, multiplier) => levelUps.push([next, multiplier]),
    });
    return { runtime, logged, levelUps, server: (nextSoul: SoulStats | null, nextLevel: SoulLevel | null) => { soul = nextSoul; level = nextLevel; } };
  }

  it("pays and shows each kill at the server's multiplier", () => {
    const c = leveled({ level: 3, xp: 10 });
    expect(c.runtime.rewardMultiplier()).toBe(4);
    c.runtime.soulKill("damage"); c.runtime.soulKill("regen"); c.runtime.soulKill("attackSpeed");
    expect(c.runtime.inPlay()).toMatchObject({ damage: 4, regen: .4 });
    expect(soulAttackSpeedBonus(c.runtime.inPlay().attackSpeed)).toBeCloseTo(.004, 9);
    expect(c.logged).toEqual(["+4 Soul Damage", "+0.4 Soul Regen", "+0.004/s Soul Attack Speed"]);
    expect(soulRewardText("critDamage", 4)).toBe("+0.008×");
    expect(c.runtime.soulLevel()).toEqual({ level: 3, xp: 13, needed: 2_700, multiplier: 4, max: false });
  });

  it("predicts what the server pays for the report, and counts it once when the row comes back", () => {
    const start = cleanSoulStats({ damage: 10, critDamage: 50, attackSpeed: 2 });
    const c = leveled({ level: 2, xp: 290 });
    c.server(start, { level: 2, xp: 290 });
    const kills: SoulStatId[] = ["damage", "damage", "health", "armor", "regen", "attackSpeed", "critDamage", "critDamage"];
    for (const stat of kills) c.runtime.soulKill(stat);
    const predicted = c.runtime.soulStats();
    // The server pays the report by stat, each at the level the report started at (noteEnemyDefeats).
    let paid = start;
    for (const stat of new Set(kills)) paid = addSoulKills(paid, stat, kills.filter(kill => kill === stat).length, soulRewardMultiplier(2));
    for (const key of Object.keys(paid) as (keyof SoulStats)[]) expect(predicted[key], key).toBeCloseTo(paid[key], 9);
    c.server(paid, addSoulXp({ level: 2, xp: 290 }, kills.length));
    const after = c.runtime.soulStats();
    for (const key of Object.keys(paid) as (keyof SoulStats)[]) expect(after[key], key).toBeCloseTo(paid[key], 9);
    expect(c.runtime.soulLevel()).toMatchObject({ level: 2, xp: 298 });
  });

  it("fills the bar with kills on their way, and levels up when the server says so", () => {
    const c = leveled({ level: 1, xp: 295 });
    c.server(null, { level: 1, xp: 295 });
    c.runtime.soulLevel();
    for (let kill = 0; kill < 10; kill++) c.runtime.soulKill("damage");
    expect(c.runtime.soulLevel()).toEqual({ level: 1, xp: 300, needed: 300, multiplier: 1, max: false });
    expect(c.levelUps).toEqual([]);
    c.server(addSoulKills(null, "damage", 10), { level: 2, xp: 5 });
    expect(c.runtime.soulLevel()).toEqual({ level: 2, xp: 5, needed: 900, multiplier: 2, max: false });
    expect(c.levelUps).toEqual([[2, 2]]);
    expect(c.runtime.rewardMultiplier()).toBe(2);
  });

  it("announces nothing when the account's row loads in, and shows the cap as Max", () => {
    const c = leveled(null);
    expect(c.runtime.soulLevel()).toMatchObject({ level: 1, xp: 0, multiplier: 1 });
    c.server(null, { level: SOUL_LEVEL_CAP, xp: 0 });
    expect(c.runtime.soulLevel()).toEqual({ level: SOUL_LEVEL_CAP, xp: 0, needed: 0, multiplier: 512, max: true });
    expect(c.levelUps).toEqual([]);
  });
});
