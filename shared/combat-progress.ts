import { MAX_ARMOR, MAX_PLAYER_STAT, MIN_ATTACK_INTERVAL } from "./rules";

/** Absolute, monotonic stats make replays safe without applying a delta twice. */
export type CombatProgress = {
  maxHp: number; damage: number; attackRate: number; projectileCount: number;
  armor: number; regen: number; enemyKills: number;
};
export const COMBAT_PROGRESS_FIELDS = ["maxHp", "damage", "attackRate", "projectileCount", "armor", "regen", "enemyKills"] as const;
export const LOADOUT_FIELDS = ["equippedHead", "equippedChest", "equippedFeet", "equippedRightHand", "equippedLeftHand",
  "cosmeticHead", "cosmeticChest", "cosmeticFeet", "cosmeticRightHand", "cosmeticLeftHand", "bootsCollected"] as const;

export function combatProgressSnapshot(progress: CombatProgress): CombatProgress {
  return Object.fromEntries(COMBAT_PROGRESS_FIELDS.map(key => [key, progress[key]])) as CombatProgress;
}
export function isCombatProgress(value: unknown): value is CombatProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as CombatProgress;
  return COMBAT_PROGRESS_FIELDS.every(key => Number.isFinite(progress[key])) &&
    Number.isInteger(progress.projectileCount) && Number.isInteger(progress.enemyKills) &&
    progress.enemyKills >= 0 && progress.enemyKills <= 0xffffffff;
}
export function mergeCombatStats<T extends Omit<CombatProgress, "enemyKills">>(base: T, incoming: CombatProgress): T {
  const bound = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return { ...base,
    maxHp: Math.max(base.maxHp, bound(incoming.maxHp, 1, MAX_PLAYER_STAT, base.maxHp)),
    damage: Math.max(base.damage, bound(incoming.damage, 1, MAX_PLAYER_STAT, base.damage)),
    attackRate: Math.min(base.attackRate, bound(incoming.attackRate, MIN_ATTACK_INTERVAL, 10, base.attackRate)),
    projectileCount: Math.max(base.projectileCount, Number.isInteger(incoming.projectileCount)
      ? bound(incoming.projectileCount, 1, 20, base.projectileCount) : base.projectileCount),
    armor: Math.max(base.armor, bound(incoming.armor, 0, MAX_ARMOR, base.armor)),
    regen: Math.max(base.regen, bound(incoming.regen, 0, MAX_PLAYER_STAT, base.regen)),
  };
}
