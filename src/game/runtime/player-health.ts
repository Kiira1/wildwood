import { clamp } from "../math";

export type PlayerHealthState = {
  hp: number;
  baseMaxHp: number;
  maxHp: number;
};

function safeBonus(bonus: number) {
  return Number.isFinite(bonus) ? Math.max(0, bonus) : 0;
}

/** Rebuilds effective max health without ever writing equipment bonuses to the save stat. */
export function applyPlayerMaxHealthBonus(player: PlayerHealthState, bonus: number, preserveRatio = true) {
  const previousMaxHp = Math.max(1, player.maxHp);
  const hpRatio = clamp(player.hp / previousMaxHp, 0, 1);
  player.maxHp = Math.max(1, player.baseMaxHp + safeBonus(bonus));
  player.hp = preserveRatio
    ? clamp(player.maxHp * hpRatio, 0, player.maxHp)
    : clamp(player.hp, 0, player.maxHp);
}

export function setPlayerBaseMaxHealth(player: PlayerHealthState, baseMaxHp: number, bonus: number, fillHealth = false) {
  player.baseMaxHp = Math.max(1, Number.isFinite(baseMaxHp) ? baseMaxHp : player.baseMaxHp);
  applyPlayerMaxHealthBonus(player, bonus, !fillHealth);
  if (fillHealth) player.hp = player.maxHp;
}

export function addPlayerBaseMaxHealth(player: PlayerHealthState, amount: number, bonus: number) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const previousMaxHp = player.maxHp;
  player.baseMaxHp += amount;
  applyPlayerMaxHealthBonus(player, bonus, false);
  player.hp = Math.min(player.maxHp, player.hp + Math.max(0, player.maxHp - previousMaxHp));
}
