import { ENEMY_TOP_CHASE_SPEED } from "./rules";
import { ENEMY_BASE_VALUES } from "./enemy-base-values";
import { CAMPAIGN_MAPS } from "./campaign-registry";
import { defaultBalanceSettings, resolveMapBalance } from "./map-balance";

export type RewardType = "damage" | "health" | "speed" | "armor" | "regen" | "crit";

/** What an enemy is before the balance curve: shared/enemy-base-values.ts. */
export type EnemyBase = {
  speed: number;
  attackSpeed: number; // Attacks per second.
  r: number;
  color: string;
  outline: string;
  /** The stat a kill pays; how much is the curve's. */
  reward: { type: RewardType };
  aggro?: number;
  ranged?: boolean;
  elite?: boolean;
};

/** An enemy as it fights: its base with the health, hit and reward amount the curve resolved for a map. */
export type EnemyDefinition = Omit<EnemyBase, "reward"> & {
  hp: number;
  damage: number;
  /** Health healed a second. */
  regen?: number;
  reward: { type: RewardType; amount: number };
};

/** Default movement speed; active chases follow the player's speed separately. */
export const CHASE_SPEED_RAMP_PER_MAP = 5;
export function campaignMeleeChaseSpeed(mapIndex: number): number {
  return mapIndex < 3 ? 205 : Math.min(ENEMY_TOP_CHASE_SPEED, 230 + (mapIndex - 3) * CHASE_SPEED_RAMP_PER_MAP);
}
export type EnemyKind = keyof typeof ENEMY_BASE_VALUES;
/**
 * Mutable runtime definitions, until a map snapshot installs its own: each campaign enemy as the curve resolves it
 * on its map at the default balance. Endless-only art has no map; Endless camps take their lane's numbers.
 */
export const ENEMY_TYPES: Record<EnemyKind, EnemyDefinition> = (() => {
  const types = {} as Record<EnemyKind, EnemyDefinition>;
  for (const [kind, base] of Object.entries(ENEMY_BASE_VALUES) as [EnemyKind, EnemyBase][]) {
    types[kind] = { ...base, hp: 1, damage: 1, reward: { ...base.reward, amount: 1 } };
  }
  const settings = defaultBalanceSettings();
  for (const map of CAMPAIGN_MAPS) {
    for (const [kind, row] of Object.entries(resolveMapBalance(map.id, settings, 0).enemies)) types[kind as EnemyKind] = JSON.parse(JSON.stringify(row));
  }
  return types;
})();
