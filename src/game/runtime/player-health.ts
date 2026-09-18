import { clamp } from "../math";

export type PlayerHealthState = {
  hp: number;
  baseMaxHp: number;
  maxHp: number;
};

function safeBonus(multiplierBonus: number) {
  return Number.isFinite(multiplierBonus) ? Math.max(0, multiplierBonus) : 0;
}

/** Rebuilds effective max health without ever writing equipment bonuses to the save stat. */
export function applyPlayerMaxHealthMultiplierBonus(player: PlayerHealthState, multiplierBonus: number, preserveRatio = true) {
  const previousMaxHp = Math.max(1, player.maxHp);
  const hpRatio = clamp(player.hp / previousMaxHp, 0, 1);
  player.maxHp = Math.max(1, player.baseMaxHp * (1 + safeBonus(multiplierBonus)));
  player.hp = preserveRatio
    ? clamp(player.maxHp * hpRatio, 0, player.maxHp)
    : clamp(player.hp, 0, player.maxHp);
}

export function setPlayerBaseMaxHealth(player: PlayerHealthState, baseMaxHp: number, multiplierBonus: number, fillHealth = false) {
  player.baseMaxHp = Math.max(1, Number.isFinite(baseMaxHp) ? baseMaxHp : player.baseMaxHp);
  applyPlayerMaxHealthMultiplierBonus(player, multiplierBonus, !fillHealth);
  if (fillHealth) player.hp = player.maxHp;
}

export function addPlayerBaseMaxHealth(player: PlayerHealthState, amount: number, multiplierBonus: number) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const previousMaxHp = player.maxHp;
  player.baseMaxHp += amount;
  applyPlayerMaxHealthMultiplierBonus(player, multiplierBonus, false);
  player.hp = Math.min(player.maxHp, player.hp + Math.max(0, player.maxHp - previousMaxHp));
}
