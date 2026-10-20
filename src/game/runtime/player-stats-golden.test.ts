import { describe, expect, it } from "vitest";
import { cardTotals } from "../../../shared/card-effects";
import { equipmentDamage, itemDefinition } from "../../../shared/items";
import { effectivePlayerPowerStats, type PlayerPowerStats } from "../../../shared/player-power";
import { prestigePerkValue } from "../../../shared/prestige-perks";
import { playerBaseMovementSpeed } from "../../../shared/rules";
import { withSoulStats } from "../../../shared/soul-dimension";
import { weaponAttackInterval } from "../../../shared/staff-skills";
import { masteryAttackRange, masteryInPlay } from "../../../shared/weapon-mastery";
import type { PlayerProfileData, PlayerProgress } from "../../coop/contracts";
import { profilePower, profileStatDisplayRows } from "../../ui/profile";
import { formatArmorReduction } from "../combat";
import { procChance, skillChanceFactor, weaponAttackRange } from "../../../shared/player-stats";
import { createFarmEvaluator } from "./auto-farm/auto-farm-build";
import { applyPlayerMaxHealthMultiplierBonus } from "./player-health";
import { createResearchController } from "./research-controller";
import { createRewardDisplay } from "./reward-display";
import { createPlayerStatsRuntime, type PlayerStatsSource } from "./player-stats-runtime";
import { fixtureAttackCap, fixtureCardIds, fixtureCardStats, fixtureItemLevel, STAT_FIXTURES, type StatFixture } from "../../../tests/helpers/player-stats-fixture";
import type { PlayerState } from "./types";

// Golden numbers for every client path that works out the player's final stats.
// They pin today's results, so moving a path onto shared/player-stats.ts cannot change one silently.

/** Ten significant digits: real changes show, last-bit float order does not. */
const pin = (value: number) => Number(value.toPrecision(10));
const pinAll = <T extends Record<string, number>>(values: T) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, pin(value)])) as T;

const inventoryOf = (fixture: StatFixture) => ({
  equippedHead: fixture.loadout.head, equippedChest: fixture.loadout.chest, equippedFeet: fixture.loadout.feet,
  equippedRightHand: fixture.loadout.rightHand, equippedLeftHand: fixture.loadout.leftHand,
});

/** The live player as the progress controller loads it: the saved run with the soul's share added. */
function worldPlayer(fixture: StatFixture) {
  const cap = fixtureAttackCap(fixture);
  const run = withSoulStats(fixture.saved, fixture.soul, cap);
  const masteryRange = masteryAttackRange(masteryInPlay(fixture.mastery, fixture.loadout.rightHand, fixture.loadout.rightHand || fixture.loadout.leftHand));
  return {
    hp: 1, baseMaxHp: run.maxHp, maxHp: run.maxHp, damage: run.damage, armor: run.armor, regen: run.regen, attackRate: run.attackRate,
    critRating: fixture.saved.critRating, speed: playerBaseMovementSpeed(false, fixture.saved.speedOverride),
    // progress-controller.ts addedRange: Long Shot cards and Archery on top of the saved range.
    attackRange: fixture.saved.attackRange + fixtureCardStats(fixture).range + masteryRange,
  } as PlayerState;
}

/** The coop session's bonuses in play, as player-stats-runtime.ts reads them. */
const sourceOf = (fixture: StatFixture): PlayerStatsSource => ({
  itemLevel: fixtureItemLevel(fixture), researchInPlay: () => fixture.research, prestigePerks: () => fixture.perks,
  activeCardTotals: () => cardTotals(fixtureCardIds(fixture)), attackCapInPlay: () => fixtureAttackCap(fixture),
  prestige: () => ({ level: fixture.prestigeLevel }), weeklyQuests: () => ({ bonus: fixture.guildBonus }),
});

/** The world's numbers, wired as main.ts and player-combat-controller.ts wire them. */
function worldStats(fixture: StatFixture) {
  const player = worldPlayer(fixture), itemLevel = fixtureItemLevel(fixture);
  const worn = cardTotals(fixtureCardIds(fixture));
  const { head, chest, feet, rightHand } = fixture.loadout;
  const live = createPlayerStatsRuntime({ player, inventory: inventoryOf(fixture), source: () => sourceOf(fixture), soul: () => fixture.soul });
  const research = createResearchController({
    player, getRanks: () => fixture.research, isDueling: () => false, maxPlayerStat: 1e300, saveProgress: () => {},
    healthMultiplierBonus: live.healthMultiplierBonus, prestigeLevel: () => fixture.prestigeLevel, guildQuestBonus: () => fixture.guildBonus,
    prestigePerks: () => fixture.perks, cards: () => fixtureCardStats(fixture), equippedFeet: () => feet, itemLevel,
  });
  applyPlayerMaxHealthMultiplierBonus(player, live.healthMultiplierBonus());
  return pinAll({
    maxHp: player.maxHp,
    damage: equipmentDamage(player.damage, rightHand, head, chest, research.damageMultiplier(), itemLevel(rightHand), itemLevel(head), itemLevel(chest)),
    armor: research.effectiveArmor(),
    regen: live.regenerationPerSecond(),
    moveSpeed: live.moveSpeed(),
    attackInterval: player.attackRate,
    weaponInterval: weaponAttackInterval(rightHand, player.attackRate),
    range: weaponAttackRange(rightHand, player.attackRange),
    critChance: research.criticalChance(),
    critMultiplier: research.criticalDamageMultiplier(fixture.soul?.critDamage ?? 0),
    reflectChance: procChance(prestigePerkValue(fixture.perks, "riposte"), worn, "reflect"),
    doubleStrikeChance: procChance(prestigePerkValue(fixture.perks, "doubleStrike"), worn, "doubleStrike"),
    splitShotChance: procChance(prestigePerkValue(fixture.perks, "splitShot"), worn, "splitShot"),
    skillChanceFactor: skillChanceFactor(head, chest, feet, itemLevel(feet)),
    statGain: research.rewardMultiplier(),
  });
}

/** The fixture as the server sends the player's own profile. */
function profileOf(fixture: StatFixture): PlayerProfileData {
  const { head, chest, feet, rightHand, leftHand } = fixture.loadout;
  return {
    identity: "golden", name: "Golden", gender: 0, research: fixture.research, itemUpgradeLevels: { ...fixture.slotTiers }, itemRefines: fixture.refines,
    activeCards: fixture.cards, prestigePerks: fixture.perks, prestigeLevel: fixture.prestigeLevel, soulStats: fixture.soul,
    progress: { ...fixture.saved, equippedHead: head, equippedChest: chest, equippedFeet: feet, equippedRightHand: rightHand, equippedLeftHand: leftHand } as unknown as PlayerProgress,
  } as PlayerProfileData;
}

/** The profile Stats tab's rows for one's own profile, as main.ts renderStats passes them. */
function profileRows(fixture: StatFixture) {
  return profileStatDisplayRows(profileOf(fixture), formatArmorReduction, fixtureAttackCap(fixture), fixture.research, fixture.prestigeLevel,
    fixture.perks, fixture.guildBonus, fixture.soul).map(({ kind, base, multiplier, total, equationTotal, expandedDetail, sources }) =>
    [kind, `${base} ${multiplier} = ${total}${equationTotal ? ` (${equationTotal})` : ""}${expandedDetail ? ` ${expandedDetail}` : ""}`,
      sources.map(source => `${source.label} ${source.value}`).join(", ")].join(" | "));
}

/** Auto-farm's evaluator, fed as main.ts feeds it (createAutoFarmProgress). */
function autoFarmStats(fixture: StatFixture) {
  const player = worldPlayer(fixture), itemLevel = fixtureItemLevel(fixture);
  const research = createResearchController({ player, getRanks: () => fixture.research, isDueling: () => false, maxPlayerStat: 1e300, saveProgress: () => {},
    prestigePerks: () => fixture.perks, cards: () => fixtureCardStats(fixture) });
  const evaluator = createFarmEvaluator({
    base: () => ({ maxHp: player.baseMaxHp, damage: player.damage, attackRate: player.attackRate, armor: player.armor, regen: player.regen }),
    equipment: () => inventoryOf(fixture), research: () => fixture.research, upgradeLevel: itemLevel, rewardMultiplier: () => 1,
    minAttackInterval: () => fixtureAttackCap(fixture), criticalChance: research.criticalChance,
    criticalMultiplier: (extra = 0) => research.criticalDamageMultiplier(fixture.soul?.critDamage ?? 0, (player.critRating ?? 0) + extra),
  });
  const { stats, power } = evaluator.evaluate() as { stats: PlayerPowerStats; power: number };
  return pinAll({ maxHp: stats.maxHp, damage: stats.damage, armor: stats.armor, regen: stats.regen, attackRate: stats.attackRate, power, dps: evaluator.dps() });
}

/** The HUD stat tracker and shown power (stat-tracker-source.ts): the core with the cards in play. */
function trackerStats(fixture: StatFixture) {
  const player = worldPlayer(fixture);
  const stats = effectivePlayerPowerStats({ maxHp: player.baseMaxHp, damage: player.damage, attackRate: player.attackRate, armor: player.armor, regen: player.regen,
    ...inventoryOf(fixture), activeCards: fixtureCardIds(fixture) }, fixture.research, fixtureItemLevel(fixture));
  return pinAll({ maxHp: stats.maxHp, damage: stats.damage, armor: stats.armor, regen: stats.regen });
}

/** The popup a base reward of 1 shows for each stat (reward-display.ts). */
function rewardPopups(fixture: StatFixture) {
  const player = worldPlayer(fixture);
  const research = createResearchController({ player, getRanks: () => fixture.research, isDueling: () => false, maxPlayerStat: 1e300, saveProgress: () => {},
    prestigeLevel: () => fixture.prestigeLevel, guildQuestBonus: () => fixture.guildBonus });
  const display = createRewardDisplay(research.rewardMultiplier, () => fixture.research, () => false, () => inventoryOf(fixture), fixtureItemLevel(fixture),
    () => fixtureCardIds(fixture));
  return pinAll({ damage: display.totalAmount("damage", 1), health: display.totalAmount("health", 1), armor: display.totalAmount("armor", 1),
    regen: display.totalAmount("regen", 1), speed: display.totalAmount("speed", 1) });
}

describe("player stat golden fixtures", () => {
  it("wear real items", () => {
    for (const fixture of STAT_FIXTURES) for (const item of Object.values(fixture.loadout)) if (item) expect(itemDefinition(item), item).toBeDefined();
  });

  it("fresh player", () => {
    const [fixture] = STAT_FIXTURES;
    expect(worldStats(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 0,
        "attackInterval": 1.56,
        "critChance": 0,
        "critMultiplier": 1.05,
        "damage": 3.15,
        "doubleStrikeChance": 0,
        "maxHp": 100,
        "moveSpeed": 200,
        "range": 200,
        "reflectChance": 0,
        "regen": 0.2,
        "skillChanceFactor": 1,
        "splitShotChance": 0,
        "statGain": 1,
        "weaponInterval": 1.56,
      }
    `);
    expect(profileRows(fixture)).toMatchInlineSnapshot(`
      [
        "health | 100 1.00 = 100 | ",
        "damage | 3 1.05 = 3 | Equipment +5%",
        "armor | 0 1.00 = 0 (0% Block) | ",
        "attack | 0.64/s 1.00 = 0 (0.64/s) (0.64/s) · 3.00/s Cap | ",
        "range | 200 1.00 = 200 | ",
        "regen | 0.20/s 1.00 = 0.20/s | ",
        "speed | 200 1.00 = 200 | ",
        "stat-gain | 1.00 1.00 = +0% (1.00×) | ",
        "critical | 0% 0% = 0% | ",
        "critical-damage | 1.05× 0.00× = 0 (1.05×) (1.05×) · 5× Cap | ",
      ]
    `);
    expect(profilePower(profileOf(fixture), fixture.soul)).toMatchInlineSnapshot(`105`);
    expect(autoFarmStats(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 0,
        "attackRate": 1.56,
        "damage": 3.15,
        "dps": 2.019230769,
        "maxHp": 100,
        "power": 105.15,
        "regen": 0.2,
      }
    `);
    expect(trackerStats(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 0,
        "damage": 3.15,
        "maxHp": 100,
        "regen": 0.2,
      }
    `);
    expect(rewardPopups(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 1,
        "damage": 1.05,
        "health": 1,
        "regen": 1,
        "speed": 1,
      }
    `);
  });

  it("mid-campaign: graded gear, slot tiers, refines, research, cards, Warrior Boots", () => {
    const fixture = STAT_FIXTURES[1];
    expect(worldStats(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 75.2724,
        "attackInterval": 0.7,
        "critChance": 0.04,
        "critMultiplier": 1.30087403,
        "damage": 826.6252176,
        "doubleStrikeChance": 0,
        "maxHp": 6836.3904,
        "moveSpeed": 242.74,
        "range": 224,
        "reflectChance": 0.015,
        "regen": 14.22828,
        "skillChanceFactor": 1,
        "splitShotChance": 0,
        "statGain": 1.1,
        "weaponInterval": 0.7,
      }
    `);
    expect(profileRows(fixture)).toMatchInlineSnapshot(`
      [
        "health | 4,200 1.63 = 6,836 | Tech +16%, Equipment +28.8%, Slot Upgrade +11.52%",
        "damage | 380 2.18 = 827 | Tech +20%, Equipment +36%, Slot Upgrade +17.28%, Refine +15.98%, Class Set +5%, Cards +2%",
        "armor | 45 1.67 = 75 (23.4% Block) | Tech +12%, Boots +45%, Cards +3%",
        "attack | 1.43/s 1.00 = 24.1k (1.43/s) (1.43/s) · 3.00/s Cap | ",
        "range | 200 1.10 = 220 | Tech +20 range",
        "regen | 9.00/s 1.58 = 14.2/s | Tech +10%, Equipment +28.8%, Slot Upgrade +9.22%, Refine +5.7%",
        "speed | 200 1.21 = 243 | Tech +10%, Tech +9 speed, Armor +6%",
        "stat-gain | 1.10 1.00 = +10% (1.10×) | Tech 1.10×",
        "critical | 0% 4% = 4% | Tech +4%",
        "critical-damage | 1.05× 0.25× = 30 (1.30×) (1.30×) · 5× Cap | Tech +0.15×",
        "riposte | 0% 1.5% = 1.5% (Reflects 100% of each hit before armor, up to half your max health; no cap in Reflect Only; half in duels) | Cards +1.5%",
      ]
    `);
    expect(profilePower(profileOf(fixture), fixture.soul)).toMatchInlineSnapshot(`9069`);
    expect(autoFarmStats(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 73.08,
        "attackRate": 0.7,
        "damage": 810.41688,
        "dps": 1171.671737,
        "maxHp": 6836.3904,
        "power": 9025.721109,
        "regen": 14.22828,
      }
    `);
    expect(trackerStats(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 75.2724,
        "damage": 826.6252176,
        "maxHp": 6836.3904,
        "regen": 14.22828,
      }
    `);
    expect(rewardPopups(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 1.26896,
        "damage": 2.392862472,
        "health": 1.7904832,
        "regen": 1.739012,
        "speed": 1.1,
      }
    `);
  });

  it("endgame prestige: soul stats, perks, mastery, class set, Black Boots, guild bonus", () => {
    const fixture = STAT_FIXTURES[2];
    expect(worldStats(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 5259.48,
        "attackInterval": 0.4499293879,
        "critChance": 0.47,
        "critMultiplier": 3.239197796,
        "damage": 7532994.731,
        "doubleStrikeChance": 0.08,
        "maxHp": 51466816.77,
        "moveSpeed": 361.735,
        "range": 138,
        "reflectChance": 0.24,
        "regen": 14288.6688,
        "skillChanceFactor": 1,
        "splitShotChance": 0.08,
        "statGain": 2.576,
        "weaponInterval": 0.4499293879,
      }
    `);
    expect(profileRows(fixture)).toMatchInlineSnapshot(`
      [
        "health | 2.50m 20.57 = 51.5m | Soul +1,500, Tech +110%, Equipment +120%, Slot Upgrade +278.4%, Refine +517.92%, Cards -3.6%",
        "damage | 180,400 41.76 = 7.53m | Soul +400, Tech +120%, Equipment +180%, Slot Upgrade +432%, Refine +918%, Class Set +5%, Cards +10.9%",
        "armor | 2,460 2.14 = 5,259 (57.7% Block) | Soul +60, Tech +100%, Cards +6.9%",
        "attack | 2.22/s 1.00 = 9.94m (2.22/s) (2.22/s) · 3.40/s Cap | Soul +0.000/s",
        "range | 75 1.80 = 135 | Tech +50 range, Prestige +10 range",
        "regen | 912/s 15.67 = 14.3k/s | Soul +12.0/s, Tech +90%, Equipment +120%, Slot Upgrade +264%, Refine +384%, Cards -5%",
        "speed | 200 1.68 = 337 | Tech +50%, Tech +15 speed, Prestige +6%, Cards +0.9%",
        "stat-gain | 1.40 1.84 = +158% (2.58×) | Tech 1.40×, Prestige 1.60×, Guild 1.15×",
        "critical | 0% 47% = 47% | Tech +20%, Prestige +25%, Cards +2%",
        "critical-damage | 1.05× 2.19× = 425 (3.24×) (3.24×) · 8× Cap | Tech +0.93×, Prestige +0.56×, Soul +0.09×",
        "double-strike | 0% 8% = 8% (Chance a hit lands twice) | Prestige +8%",
        "split-shot | 0% 8% = 8% (Chance to strike a second enemy) | Prestige +8%",
        "riposte | 0% 24% = 24% (Reflects 100% of each hit before armor, up to half your max health; no cap in Reflect Only; half in duels) | Prestige +24%",
      ]
    `);
    expect(profilePower(profileOf(fixture), fixture.soul)).toMatchInlineSnapshot(`105231650`);
    expect(autoFarmStats(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 4920,
        "attackRate": 0.4499293879,
        "damage": 6792601.2,
        "dps": 30985508.09,
        "maxHp": 53388814.08,
        "power": 101891373.7,
        "regen": 15040.704,
      }
    `);
    expect(trackerStats(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 5259.48,
        "damage": 7532994.731,
        "maxHp": 51466816.77,
        "regen": 14288.6688,
      }
    `);
    expect(rewardPopups(fixture)).toMatchInlineSnapshot(`
      {
        "armor": 5.507488,
        "damage": 107.566488,
        "health": 52.99960824,
        "regen": 40.3592224,
        "speed": 2.576,
      }
    `);
  });
});

describe("shared/player-stats.ts against the golden numbers", () => {
  it("gives the world's numbers for every fixture", () => {
    for (const fixture of STAT_FIXTURES) {
      const live = createPlayerStatsRuntime({ player: worldPlayer(fixture), inventory: inventoryOf(fixture), source: () => sourceOf(fixture), soul: () => fixture.soul });
      const stats = live.stats();
      expect(pinAll({
        maxHp: stats.maxHp, damage: stats.damage, armor: stats.armor, regen: stats.regenPerSecond, moveSpeed: stats.moveSpeed,
        attackInterval: stats.attackInterval, weaponInterval: stats.weaponInterval, range: stats.range, critChance: stats.critChance,
        critMultiplier: stats.critMultiplier, reflectChance: stats.reflectChance, doubleStrikeChance: stats.doubleStrikeChance,
        splitShotChance: stats.splitShotChance, skillChanceFactor: stats.skillChanceFactor, statGain: stats.statGain,
      }), fixture.name).toEqual(worldStats(fixture));
      expect(pin(stats.multipliers.maxHp - 1), fixture.name).toBe(pin(live.healthMultiplierBonus()));
    }
  });
});

// Where today's client paths disagree with the world (docs/player-stats.md, Known disagreements).
// These pin the bugs as they are; fixing one means changing its line here on purpose.
describe("known disagreements between client paths", () => {
  const [, mid, endgame] = STAT_FIXTURES;
  it("1: auto-farm prices kills without the active cards' stat factors", () => {
    expect(autoFarmStats(mid).armor).toBeLessThan(worldStats(mid).armor);
    expect(autoFarmStats(endgame).damage).toBeLessThan(worldStats(endgame).damage);
  });

  it("5: armor reward popups leave Warrior Boots out", () => {
    const world = worldStats(mid);
    expect(trackerStats(mid).armor).toBeCloseTo(world.armor);
    // What one base armor adds in the world, against what the popup says it adds.
    expect(rewardPopups(mid).armor / world.statGain).toBeLessThan(world.armor / worldPlayer(mid).armor - .01);
  });

  it("6: the profile's Move Speed leaves Black Boots out, and its Range leaves Long Shot cards and Archery out", () => {
    const speed = profileStatDisplayRows(profileOf(endgame), formatArmorReduction, fixtureAttackCap(endgame), endgame.research, endgame.prestigeLevel,
      endgame.perks, endgame.guildBonus, endgame.soul).find(row => row.kind === "speed")!;
    expect(Number(speed.total.replace(/,/g, ""))).toBeLessThan(worldStats(endgame).moveSpeed - 20);
    const range = profileStatDisplayRows(profileOf(mid), formatArmorReduction, fixtureAttackCap(mid), mid.research).find(row => row.kind === "range")!;
    expect(Number(range.total)).toBeLessThan(worldStats(mid).range);
  });
});
