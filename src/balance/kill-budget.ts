import { calibratedBossKillTarget } from "../../shared/boss-kill-budget";
import { BOSS_REGEN_FRACTION_PER_SECOND } from "../../shared/boss-regeneration";

export type KillBudgetConfig = {
  enabled: boolean;
  curve?: "calibrated" | "custom";
  damageKills: number;
  healthKills: number;
  campaignGrowth: number;
  endlessGrowth: number;
};
export const DEFAULT_KILL_BUDGET: KillBudgetConfig = {
  enabled: false, curve: "calibrated", damageKills: 125, healthKills: 135, campaignGrowth: 1.45, endlessGrowth: 1.25,
};
export type BossReadinessInput = {
  bossHp: number;
  bossHitAfterArmor: number;
  hitDamage: number;
  health: number;
  damagePerKill: number;
  healthPerKill: number;
  attackInterval: number;
  firstHitSeconds: number;
  targetSeconds: number;
  maxHitShare: number;
};
export type BossReadiness = {
  damageKills: number | null;
  healthKills: number | null;
  totalKills: number | null;
  damageGap: number;
  healthGap: number;
};
export type BossReadinessComparison = {
  basis: BossReadinessInput;
  current: BossReadiness;
  proposed: BossReadiness;
  bossHpMultiplier: number;
  bossDamageMultiplier: number;
  targetSeconds: number;
  damageEnemy: string;
  healthEnemy: string;
};
export function normalizeKillBudget(input?: Partial<KillBudgetConfig>): KillBudgetConfig {
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback;
  return { enabled: input?.enabled === true, curve: input?.curve === "custom" ? "custom" : "calibrated",
    damageKills: Math.round(bounded(input?.damageKills, 125, 1, 1e6)),
    healthKills: Math.round(bounded(input?.healthKills, 135, 1, 1e6)),
    campaignGrowth: bounded(input?.campaignGrowth, 1.45, 1, 3),
    endlessGrowth: bounded(input?.endlessGrowth, 1.25, 1, 3) };
}
export function killTargets(config: KillBudgetConfig, mapIndex: number, campaignMaps: number) {
  if (config.curve !== "custom") return calibratedBossKillTarget(mapIndex);
  const growth = config.campaignGrowth ** Math.min(mapIndex, campaignMaps - 1) *
    config.endlessGrowth ** Math.max(0, mapIndex - campaignMaps + 1);
  return { damage: Math.min(1e9, Math.round(config.damageKills * growth)),
    health: Math.min(1e9, Math.round(config.healthKills * growth)) };
}
function bossDamagePerHp(input: BossReadinessInput) {
  const hits = Math.max(1, Math.floor((input.targetSeconds - input.firstHitSeconds) / input.attackInterval) + 1);
  return (1 + (hits - 1) * BOSS_REGEN_FRACTION_PER_SECOND * input.attackInterval) / hits;
}
export function minimumReadinessKills(input: BossReadinessInput): BossReadiness {
  const damageGap = Math.max(0, input.bossHp * bossDamagePerHp(input) - input.hitDamage);
  const healthGap = Math.max(0, input.bossHitAfterArmor / input.maxHitShare - input.health);
  const kills = (gap: number, gain: number) => gap === 0 ? 0 : gain > 0 ? Math.ceil(gap / gain - 1e-8) : null;
  const damageKills = kills(damageGap, input.damagePerKill);
  const healthKills = kills(healthGap, input.healthPerKill);
  return { damageKills, healthKills, totalKills: damageKills === null || healthKills === null ? null : damageKills + healthKills,
    damageGap, healthGap };
}
/** Scale boss requirements from the actual entry build; rewards and regular enemies stay authored.
 * A fixed-build diagnostic: armor, attack speed, gear and research are frozen.
 * These are separate damage/health farming requirements, not a global optimum
 * over armor/speed alternatives or a guarantee of surviving the whole encounter. */
export function compareKillBudget(input: BossReadinessInput, targets: { damage: number; health: number }): Omit<BossReadinessComparison, "damageEnemy" | "healthEnemy"> {
  const hp = input.damagePerKill > 0
    ? (input.hitDamage + input.damagePerKill * targets.damage) / bossDamagePerHp(input) : input.bossHp;
  const hit = input.healthPerKill > 0
    ? (input.health + input.healthPerKill * targets.health) * input.maxHitShare : input.bossHitAfterArmor;
  return { basis: { ...input }, current: minimumReadinessKills(input), proposed: minimumReadinessKills({ ...input, bossHp: hp, bossHitAfterArmor: hit }),
    bossHpMultiplier: hp / input.bossHp, bossDamageMultiplier: input.bossHitAfterArmor > 0 ? hit / input.bossHitAfterArmor : 1,
    targetSeconds: input.targetSeconds };
}
