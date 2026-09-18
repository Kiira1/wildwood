import type { EnemyDefinition } from './enemy-definitions';
export type BalanceFactors = { enemyHealth: number; enemyDamage: number; enemyRewards: number; enemySpeed: number; bossHealth: number; bossDamage: number; bossRewards: number };
export const DEFAULT_BALANCE_FACTORS: BalanceFactors = { enemyHealth: 1, enemyDamage: 1, enemyRewards: 1, enemySpeed: 1, bossHealth: 1, bossDamage: 1, bossRewards: 1 };
export type BalanceSettings = { maps: Record<string, BalanceFactors>; endless: { rewardMultiplier: number; statStep: number; enduranceStep: number; enduranceExponent: number } };
export type MapBalanceSnapshot = { schema: 1; revision: number; mapId: string; enemies: Record<string, EnemyDefinition>; lanes: Record<string, { hp: number; damage: number; reward: EnemyDefinition['reward'] }>; boss: null | { kind: string; hp: number; respawnSeconds: number; damage: number; attacks: Record<string, number>; rewards: Record<string, number> }; rules: Record<string, number> };
export type BalanceEditorState = { revision: number; settings: BalanceSettings; previousRevision: number | null };
