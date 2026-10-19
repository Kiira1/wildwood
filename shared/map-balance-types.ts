import type { MapLootDrop } from './regular-map-loot';
import type { EnemyDefinition } from './enemy-definitions';
export type BalanceFactors = { enemyHealth: number; enemyDamage: number; enemyRewards: number; enemySpeed: number; bossHealth: number; bossDamage: number; enemyRespawn: number; bossRespawn: number; bossRegen: number; enemyDrops: number };
export const DEFAULT_BALANCE_FACTORS: BalanceFactors = { enemyHealth: 1, enemyDamage: 1, enemyRewards: 1, enemySpeed: 1, bossHealth: 1, bossDamage: 1, enemyRespawn: 1, bossRespawn: 1, bossRegen: 1, enemyDrops: 1 };
/** The balance: the curve (curveVersion 2, shared/curve-steps.ts) and each map's factors on top of it, 1 for none. */
export type BalanceSettings = { curveVersion: 2; maps: Record<string, BalanceFactors> };
export type MapBalanceSnapshot = { schema: 1; enemyDamageVersion?: 1; configurationVersion?: 2; regularRespawnSeconds?: number; regularRespawnBaseSeconds?: number; loot?: readonly MapLootDrop[]; revision: number; mapId: string; enemies: Record<string, EnemyDefinition>; lanes: Record<string, { hp: number; damage: number; reward: EnemyDefinition['reward'] }>; boss: null | { kind: string; hp: number; respawnSeconds: number; regenFraction?: number; damage: number; attacks: Record<string, number>; rewards: Record<string, number> }; rules: Record<string, number> };
export type BalanceEditorState = { revision: number; settings: BalanceSettings; previousRevision: number | null };
