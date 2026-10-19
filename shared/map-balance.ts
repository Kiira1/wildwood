import { CAMPAIGN_PROGRESSION_ENEMIES } from './campaign-progression';
import { SMOOTH_BOSSES, SMOOTH_ENEMIES } from './smooth-curve';
import { CURVE_STEPS } from './curve-steps';
import { applyCampaignRewardFloor } from './campaign-reward-floor';
import { CAMPAIGN_HEALTH_FACTORS } from './campaign-health-curve';
import { LEGACY_ENEMY_REWARDS } from "./legacy-enemy-rewards";
import { BALANCE_BASELINE_VERSION, BAKED_ENEMY_REWARD_FACTORS, BAKED_ENDLESS_DEFAULTS } from "./balance-baseline";
import { bossHeavyHitAt } from "./progression";
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
import { BOSS_DAMAGE_PROFILES } from './boss-damage';
import { DEFAULT_BALANCE_FACTORS, type BalanceSettings, type MapBalanceSnapshot } from './map-balance-types';
import { ratingRewardPerKill } from './stat-rating';
/**
 * Attack speed and crit camps (0.901.47) fight like their map's damage camp of the same rarity, and pay rating
 * points on their own curve (stat-rating.ts): the map's per-kill rating, whatever its reward factors say.
 */
const paysRating = (type: string) => type === 'speed' || type === 'crit';
const combatRole = (row: { elite?: boolean; reward: { type: string } }) =>
  `${row.elite ? 'elite' : 'regular'}:${paysRating(row.reward.type) ? 'damage' : row.reward.type}`;
const AUTHORED_ENEMIES = structuredCloneSafe(ENEMY_TYPES);
function structuredCloneSafe<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
export const BALANCE_MAPS: readonly (readonly [string, string, string])[] = [
  ...CAMPAIGN_MAPS.map((map, index) => [map.id, `${index + 1} · ${map.name}`, map.bossArt] as const),
  ['endless', 'Endless', ''],
];
/** The curve (shared/smooth-curve.ts) with every factor at 1: a factor is only ever a deliberate tweak on top. */
export function defaultBalanceSettings(): BalanceSettings {
  return { baselineVersion: BALANCE_BASELINE_VERSION, curveVersion: 2, maps: Object.fromEntries(BALANCE_MAPS.map(([id]) => [id, { ...DEFAULT_BALANCE_FACTORS }])),
    endless: { ...BAKED_ENDLESS_DEFAULTS } };
}
export function validateBalanceSettings(value: unknown): BalanceSettings {
  const input = value as BalanceSettings;
  const result = defaultBalanceSettings();
  if (input?.curveVersion !== undefined && input.curveVersion !== 2) throw new Error('Unsupported balance curve.');
  if (input?.curveVersion !== 2) delete result.curveVersion; // Archived settings keep the curves they were made with.
  if (input?.campaignProgressionVersion !== undefined && input.campaignProgressionVersion !== 1) throw new Error('Unsupported campaign progression curve.');
  if (input?.campaignProgressionVersion === 1) result.campaignProgressionVersion = 1;
  else delete result.campaignProgressionVersion;
  if (input?.campaignRewardVersion !== undefined && input.campaignRewardVersion !== 1) throw new Error('Unsupported campaign reward floor.');
  if (input?.campaignRewardVersion === 1) result.campaignRewardVersion = 1;
  else delete result.campaignRewardVersion;
  if (input?.campaignHealthVersion !== undefined && input.campaignHealthVersion !== 1) throw new Error('Unsupported campaign health curve.');
  if (input?.campaignHealthVersion === 1) result.campaignHealthVersion = 1;
  else delete result.campaignHealthVersion; // Archived settings keep their original HP.
  if (input?.baselineVersion !== undefined && input.baselineVersion !== BALANCE_BASELINE_VERSION) throw new Error('Unsupported balance baseline.');
  for (const [map] of BALANCE_MAPS) for (const field of Object.keys(DEFAULT_BALANCE_FACTORS) as (keyof typeof DEFAULT_BALANCE_FACTORS)[]) {
    const optional = ['enemyRespawn', 'bossRespawn', 'bossRegen', 'enemyDrops'].includes(field);
    const raw = input?.maps?.[map]?.[field];
    const n = raw === undefined && (optional || input?.maps?.[map] === undefined) ? 1 : raw;
    const baked = field === 'enemyRewards' ? BAKED_ENEMY_REWARD_FACTORS[map] ?? 1 : 1;
    const min = field === 'bossRegen' || field === 'enemyDrops' ? 0 : .01 / (input?.baselineVersion === 2 ? baked : 1);
    if (!Number.isFinite(n) || n < min || n > 100 || (field === 'enemySpeed' && n > 3)) throw new Error(`Invalid ${map} ${field} (${min}–${field === 'enemySpeed' ? 3 : 100}).`);
    // Old revisions use pre-bake multipliers. Convert once; saved/editor settings
    // carry a version so loading them again cannot divide a second time.
    result.maps[map][field] = input?.baselineVersion === 2 ? n : n / baked;
  }
  for (const field of Object.keys(result.endless) as (keyof BalanceSettings['endless'])[]) {
    const stored = input?.endless?.[field];
    // Versions saved before a field existed keep its authored value rather than
    // failing to load; anything actually present is still validated.
    const n = stored === undefined && field === 'rewardPerHealth' ? result.endless[field] : stored;
    const max = field === 'enduranceExponent' ? 6 : field === 'rewardMultiplier' || field === 'rewardPerHealth' ? 10 : 1;
    if (n === undefined || !Number.isFinite(n) || n < .001 || n > max) throw new Error(`Invalid Endless ${field} (0.001–${max}).`);
    result.endless[field] = n;
  }
  return result;
}
/**
 * How much each Endless map grows over the one before. Endless 1 is map 15
 * times the Endless factors (settings.maps.endless); these grow every map
 * after it, the same for every camp. Retuned in the Balance Lab (2026-10-01,
 * 0.845) against a typical player with research and gear, past a boss that
 * takes 12 minutes on arrival:
 * - health and bossHealth ~5.2: a regular keeps taking 8 hits to kill, and
 *   each boss keeps its 12-minute gate;
 * - hit 5.68: from Endless 2 on a regular's hit takes about 7.5% of the
 *   player's health, as in the campaign (Endless 1 is gentler, about 5%);
 * - reward 4.75: map time grows about 8% a map. It keeps growing, since maps
 *   are finite, but slowly.
 * At about 5x a map, enemies reach the stat cap around Endless 30.
 */
/** Every regen-paying enemy's reward, times this, campaign and Endless alike. */
export const REGEN_REWARD_BOOST = 1.5;

export const ENDLESS_STEPS: Readonly<{ health: number; hit: number; reward: number; bossHealth: number }> = Object.freeze({ health: 5.2, hit: 5.68, reward: 4.75, bossHealth: 5.06 });

/** Resolved numbers cross the wire; apps do not need the current scaling formula. */
export function resolveMapBalance(mapId: string, settings: BalanceSettings, revision: number, configurationVersion: 1 | 2 = 2): MapBalanceSnapshot {
  // Also cover direct callers (Balance Lab and archived settings), not only server saves.
  if (settings.baselineVersion !== BALANCE_BASELINE_VERSION) settings = validateBalanceSettings(settings);
  const result: MapBalanceSnapshot = { schema: 1, enemyDamageVersion: 1, revision, mapId, enemies: {}, lanes: {}, boss: null, rules: {} };
  if (configurationVersion === 2) result.configurationVersion = 2;
  if (!combatMap(mapId)) return result;
  const generated = isProceduralMap(mapId);
  const factors = settings.maps[generated ? 'endless' : mapId];
  const definition = personalBossDefinition(mapId, true)!;
  if (generated) {
    // Endless N carries on from map 15: its resolved enemies and boss (with map
    // 15's tuning), times the Endless factors, grown N - 1 times by
    // ENDLESS_STEPS, the same for every camp.
    // Endless 1 is map 15 times the Endless factors; each map after grows by the steps.
    // On the curve (curveVersion 2) Endless 1 is one more step on from map 15, as every map is from the one before.
    const curve = settings.curveVersion === 2;
    const map = generateMap(mapId), depth = Math.min(curve ? map.number : map.number - 1, 1_000);
    const steps = curve ? { health: CURVE_STEPS.health, hit: CURVE_STEPS.damage, reward: CURVE_STEPS.reward, bossHealth: CURVE_STEPS.health } : ENDLESS_STEPS;
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
    const smooth = settings.curveVersion === 2 ? SMOOTH_ENEMIES[mapId] : undefined;
    for (const kind of Object.keys(ENEMY_TYPES) as EnemyKind[]) {
      if (!enemyDefeatDefinition(mapId, kind)) continue;
      const row = AUTHORED_ENEMIES[kind];
      // On the curve, the baked values are final (regen boost and all): only the factors go on top.
      const baked = smooth?.[kind];
      if (baked) {
        result.enemies[kind] = { ...row, hp: baked.hp * factors.enemyHealth, damage: baked.damage * factors.enemyDamage,
          speed: row.speed * factors.enemySpeed, reward: { ...row.reward, amount: baked.reward * factors.enemyRewards } };
        continue;
      }
      const curve = settings.campaignProgressionVersion === 1 && mapId !== CAMPAIGN_MAPS[0].id
        ? CAMPAIGN_PROGRESSION_ENEMIES[mapId]?.[combatRole(row)] : undefined;
      result.enemies[kind] = { ...row, hp: row.hp * (settings.campaignHealthVersion === 1
          ? CAMPAIGN_HEALTH_FACTORS[mapId]?.[combatRole(row)] ?? 1 : 1) * (curve?.hp ?? 1) * factors.enemyHealth, damage: (curve?.damage ?? row.damage) * factors.enemyDamage,
        speed: row.speed * factors.enemySpeed, reward: { ...row.reward, amount: (curve?.reward ?? row.reward.amount) * factors.enemyRewards } };
    }
    if (!smooth && settings.campaignRewardVersion === 1) applyCampaignRewardFloor(mapId, settings, result.enemies);
    // Regen camps pay half again (0.845); Endless inherits it from map 15. The curve has it baked in.
    if (!smooth) for (const enemy of Object.values(result.enemies)) if (enemy.reward.type === 'regen') enemy.reward = { ...enemy.reward, amount: enemy.reward.amount * REGEN_REWARD_BOOST };
    const mapNumber = CAMPAIGN_MAPS.findIndex(map => map.id === mapId) + 1;
    for (const enemy of Object.values(result.enemies)) {
      if (paysRating(enemy.reward.type)) enemy.reward = { ...enemy.reward, amount: ratingRewardPerKill(mapNumber) };
    }
    const prefix = BALANCE_MAPS.find(([id]) => id === mapId)![2];
    const rewardValues: Record<string, number> = {};
    // Sorted, as the module namespace this once read was, so a snapshot's keys keep their order.
    for (const [key, value] of Object.entries(AUTHORED_BOSS_RULES).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (key === `${prefix}_MAX_HP`) result.rules[key] = (smooth ? SMOOTH_BOSSES[mapId].hp : value) * factors.bossHealth;
      // Bosses pay nothing: beating one opens the next map.
      if (key.startsWith(`${prefix}_REWARD_`)) {
        result.rules[key] = 0;
        rewardValues[key.slice(`${prefix}_REWARD_`.length).toLowerCase()] = 0;
      }
    }
    const campaignIndex = CAMPAIGN_MAPS.findIndex(map => map.id === mapId);
    const attacks = smooth ? SMOOTH_BOSSES[mapId].attacks : BOSS_DAMAGE_PROFILES[definition.kind as keyof typeof BOSS_DAMAGE_PROFILES]
      ?? { heavy: bossHeavyHitAt(Math.max(0, campaignIndex - 1)) };
    if (!Object.keys(rewardValues).length) {
      for (const stat of ['damage', 'health', 'armor', 'regen'] as const) rewardValues[stat] = 0;
    }
    result.boss = { ...definition, hp: (smooth ? SMOOTH_BOSSES[mapId].hp : definition.hp) * factors.bossHealth, damage: 0,
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
