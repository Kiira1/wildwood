import { CURVE_BOSS_ATTACKS, CURVE_BOSS_HEALTH, CURVE_FOREST, CURVE_ROLES } from './curve-shape';
import { CURVE_HIT_LEVEL, CURVE_STEPS } from './curve-steps';
import { LEGACY_ENEMY_REWARDS } from "./legacy-enemy-rewards";
import { CAMPAIGN_MAPS, CAMPAIGN_ENDPOINT } from "./campaign-registry";
import { regularMapLoot } from './regular-map-loot';
import { bossRegenFractionFor } from './boss-regeneration';
import { REGULAR_ENEMY_RESPAWN_SECONDS } from './rules';
import { generatedEnemyArt } from "./procedural-enemy-art";
import * as rules from './rules';
import { AUTHORED_BOSS_RULES } from './rules';
import { ENEMY_TYPES, type EnemyKind } from './enemy-definitions';
import { enemyDefeatDefinition, combatMap } from './enemy-defeats';
import { personalBossDefinition } from './personal-bosses';
import { generateMap, isProceduralMap } from './procedural-maps';
import { DEFAULT_BALANCE_FACTORS, type BalanceFactors, type BalanceSettings, type MapBalanceSnapshot } from './map-balance-types';
import BALANCE_TWEAKS from './balance-tweaks.json';
import { ratingRewardPerKill } from './stat-rating';
/**
 * Attack speed and crit camps (0.901.47) fight like their map's damage camp of the same rarity, and pay rating
 * points on their own curve (stat-rating.ts): the map's per-kill rating, whatever its reward factors say.
 */
const paysRating = (type: string) => type === 'speed' || type === 'crit';
const combatRole = (row: { elite?: boolean; reward: { type: string } }) =>
  `${row.elite ? 'elite' : 'regular'}:${paysRating(row.reward.type) ? 'damage' : row.reward.type}`;
const AUTHORED_ENEMIES: typeof ENEMY_TYPES = JSON.parse(JSON.stringify(ENEMY_TYPES));
export const BALANCE_MAPS: readonly (readonly [string, string, string])[] = [
  ...CAMPAIGN_MAPS.map((map, index) => [map.id, `${index + 1} · ${map.name}`, map.bossArt] as const),
  ['endless', 'Endless', ''],
];
/**
 * The game's balance: the curve (shared/curve-steps.ts over shared/curve-shape.ts) with every factor at 1, but for
 * deliberate tweaks kept in shared/balance-tweaks.json (npm run balance:adopt copies the live ones there).
 */
export function defaultBalanceSettings(): BalanceSettings {
  const tweaks = BALANCE_TWEAKS as Readonly<Record<string, Partial<BalanceFactors>>>;
  return { curveVersion: 2, maps: Object.fromEntries(BALANCE_MAPS.map(([id]) => [id, { ...DEFAULT_BALANCE_FACTORS, ...tweaks[id] }])) };
}
/** Saved settings as the curve reads them: every factor checked. Settings made before the curve (0.915) are refused. */
export function validateBalanceSettings(value: unknown): BalanceSettings {
  const input = value as BalanceSettings;
  if (input?.curveVersion !== 2) throw new Error('This balance was made before the balance curve (0.915) and cannot be used.');
  const result = defaultBalanceSettings();
  for (const [map] of BALANCE_MAPS) for (const field of Object.keys(DEFAULT_BALANCE_FACTORS) as (keyof typeof DEFAULT_BALANCE_FACTORS)[]) {
    const raw = input.maps?.[map]?.[field];
    const n = raw === undefined ? 1 : raw;
    const min = field === 'bossRegen' || field === 'enemyDrops' ? 0 : .01;
    if (!Number.isFinite(n) || n < min || n > 100 || (field === 'enemySpeed' && n > 3)) throw new Error(`Invalid ${map} ${field} (${min}–${field === 'enemySpeed' ? 3 : 100}).`);
    result.maps[map][field] = n;
  }
  return result;
}
/** A campaign map's damage camp on the curve: the Forest's, grown by the steps, hits CURVE_HIT_LEVEL higher from map 2 on. */
function curveCamp(index: number) {
  return { hp: CURVE_FOREST.hp * CURVE_STEPS.health ** index, damage: CURVE_FOREST.damage * CURVE_STEPS.damage ** index * (index ? CURVE_HIT_LEVEL : 1),
    reward: CURVE_FOREST.reward * CURVE_STEPS.reward ** index };
}

/** Resolved numbers cross the wire; apps do not need the current scaling formula. */
export function resolveMapBalance(mapId: string, settings: BalanceSettings, revision: number, configurationVersion: 1 | 2 = 2): MapBalanceSnapshot {
  // Also cover direct callers (Balance Lab and archived settings), not only server saves.
  if (settings.curveVersion !== 2) settings = validateBalanceSettings(settings);
  const result: MapBalanceSnapshot = { schema: 1, enemyDamageVersion: 1, revision, mapId, enemies: {}, lanes: {}, boss: null, rules: {} };
  if (configurationVersion === 2) result.configurationVersion = 2;
  if (!combatMap(mapId)) return result;
  const generated = isProceduralMap(mapId);
  const factors = settings.maps[generated ? 'endless' : mapId];
  const definition = personalBossDefinition(mapId, true)!;
  if (generated) {
    // Endless N carries on from map 15 by the curve's steps, N more of them, the same for every camp.
    const map = generateMap(mapId), depth = Math.min(map.number, 1_000);
    const steps = { health: CURVE_STEPS.health, hit: CURVE_STEPS.damage, reward: CURVE_STEPS.reward, bossHealth: CURVE_STEPS.health };
    const last = resolveMapBalance(CAMPAIGN_ENDPOINT.mapId, settings, revision, configurationVersion);
    const cap = (n: number) => Math.min(rules.MAX_PLAYER_STAT, Number.isFinite(n) ? n : rules.MAX_PLAYER_STAT);
    const grow = (n: number, step: number) => cap(n * step ** depth);
    // A camp's values on map 15. It has some camps only as an elite (its regen
    // camp): the other version is scaled by the damage camp's elite-to-regular ratio.
    const camp = (type: string, elite: boolean) => {
      const rows = Object.values(last.enemies);
      const exact = rows.find(row => row.reward.type === type && Boolean(row.elite) === elite);
      if (exact) return exact;
      const regular = rows.find(row => row.reward.type === 'damage' && !row.elite)!;
      const other = rows.find(row => row.reward.type === type);
      const eliteDamage = rows.find(row => row.reward.type === 'damage' && row.elite);
      if (!other || !eliteDamage) return regular;
      const k = elite ? 1 : -1, ratio = (a: number, b: number) => (a / b) ** k;
      return { ...other, elite, hp: other.hp * ratio(eliteDamage.hp, regular.hp), damage: other.damage * ratio(eliteDamage.damage, regular.damage),
        reward: { ...other.reward, amount: other.reward.amount * ratio(eliteDamage.reward.amount, regular.reward.amount) } };
    };
    const lanes = new Set([...map.camps.map(c => c.lane), 'Dread Warden' as const]);
    for (const lane of lanes) {
      const authored = AUTHORED_ENEMIES[lane], elite = lane === 'Dread Warden' || lane === 'King Slime';
      const now = camp(authored.reward.type, elite);
      result.lanes[lane] = {
        hp: grow(now.hp * factors.enemyHealth, steps.health),
        damage: grow(now.damage * factors.enemyDamage, steps.hit),
        reward: { ...now.reward, amount: paysRating(now.reward.type) ? ratingRewardPerKill(CAMPAIGN_MAPS.length + map.number)
          : grow(now.reward.amount * factors.enemyRewards, steps.reward) },
      };
    }
    // Generated camps reuse art, but receive these resolved combat values at spawn.
    const art = generatedEnemyArt(mapId);
    result.enemies[art] = { ...AUTHORED_ENEMIES[art],
      reward: { ...AUTHORED_ENEMIES[art].reward, amount: LEGACY_ENEMY_REWARDS[art] ?? AUTHORED_ENEMIES[art].reward.amount },
      speed: 275 * factors.enemySpeed };
    const heaviest = Math.max(...Object.values(last.boss!.attacks), last.boss!.damage);
    result.boss = { kind: definition.kind,
      hp: grow(last.boss!.hp * factors.bossHealth, steps.bossHealth),
      damage: grow(heaviest * factors.bossDamage, steps.hit),
      respawnSeconds: definition.respawnSeconds, attacks: {},
      rewards: {} };
  } else {
    // Every enemy is its role's multiple of the map's damage camp on the curve; the Forest's Spitter is as authored.
    const index = CAMPAIGN_MAPS.findIndex(map => map.id === mapId), camp = curveCamp(index);
    for (const kind of Object.keys(ENEMY_TYPES) as EnemyKind[]) {
      if (!enemyDefeatDefinition(mapId, kind)) continue;
      const row = AUTHORED_ENEMIES[kind];
      const shape = kind === 'Spitter' ? { hp: row.hp / camp.hp, damage: row.damage / camp.damage, reward: row.reward.amount / camp.reward } : CURVE_ROLES[combatRole(row)];
      result.enemies[kind] = { ...row, hp: camp.hp * shape.hp * factors.enemyHealth, damage: camp.damage * shape.damage * factors.enemyDamage,
        speed: row.speed * factors.enemySpeed, reward: { ...row.reward, amount: camp.reward * shape.reward * factors.enemyRewards } };
    }
    const mapNumber = index + 1;
    for (const enemy of Object.values(result.enemies)) {
      if (paysRating(enemy.reward.type)) enemy.reward = { ...enemy.reward, amount: ratingRewardPerKill(mapNumber) };
    }
    const prefix = BALANCE_MAPS.find(([id]) => id === mapId)![2];
    const rewardValues: Record<string, number> = {};
    // Sorted, as the module namespace this once read was, so a snapshot's keys keep their order.
    for (const key of Object.keys(AUTHORED_BOSS_RULES).sort()) {
      if (key === `${prefix}_MAX_HP`) result.rules[key] = camp.hp * CURVE_BOSS_HEALTH * factors.bossHealth;
      // Bosses pay nothing: beating one opens the next map.
      if (key.startsWith(`${prefix}_REWARD_`)) {
        result.rules[key] = 0;
        rewardValues[key.slice(`${prefix}_REWARD_`.length).toLowerCase()] = 0;
      }
    }
    const attacks = Object.fromEntries(Object.entries(CURVE_BOSS_ATTACKS[mapId]).map(([key, share]) => [key, camp.damage * share]));
    if (!Object.keys(rewardValues).length) {
      for (const stat of ['damage', 'health', 'armor', 'regen'] as const) rewardValues[stat] = 0;
    }
    result.boss = { ...definition, hp: camp.hp * CURVE_BOSS_HEALTH * factors.bossHealth, damage: 0,
      attacks: Object.fromEntries(Object.entries(attacks).map(([key, value]) => [key, value * factors.bossDamage])), rewards: rewardValues };
  }
  if (configurationVersion === 2) {
    result.configurationVersion = 2;
    result.regularRespawnSeconds = REGULAR_ENEMY_RESPAWN_SECONDS * (factors.enemyRespawn ?? 1);
    // The base it was scaled from, so a snapshot pinned under an older base
    // can be told apart and re-pinned (see pinMapBalance).
    result.regularRespawnBaseSeconds = REGULAR_ENEMY_RESPAWN_SECONDS;
    result.loot = regularMapLoot(mapId, true).map(drop => (factors.enemyDrops ?? 1) === 1 ? { ...drop } : ({
      itemId: drop.itemId, outcomes: 1_000_000,
      wins: Math.min(1_000_000, Math.round(drop.wins / drop.outcomes * (factors.enemyDrops ?? 1) * 1_000_000)),
    }));
    if (result.boss) {
      result.boss.respawnSeconds *= factors.bossRespawn ?? 1;
      result.boss.regenFraction = bossRegenFractionFor(mapId) * (factors.bossRegen ?? 1);
    }
  }
  for (const n of [result.boss?.hp, result.boss?.damage, ...Object.values(result.boss?.rewards ?? {}), ...Object.values(result.lanes).flatMap(row => [row.hp, row.damage, row.reward.amount])]) {
    if (n !== undefined && (!Number.isFinite(n) || n < 0 || n > rules.MAX_PLAYER_STAT)) throw new Error('Balance exceeds supported stat range.');
  }
  return result;
}
