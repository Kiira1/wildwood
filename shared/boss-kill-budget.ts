import { endlessScaling } from "./endless-balance";

/** Fixed boss calibration from seeded median entry builds. Actual players retain
 * their earned advantage: live bosses never rescale to the player.
 * Counts target the best local damage/health reward at fixed entry gear, research,
 * attack speed and armor, a 90-second fight, and a strongest hit of 30% HP. */
export const BOSS_KILL_BUDGETS = [
  { damage: 125, health: 135, hpScale: 1.00778593784, hitScale: 1.01457268375 }, // tutorial_forest
  { damage: 65, health: 520, hpScale: 1.00085481439, hitScale: 0.992999252179 }, // beginner_desert
  { damage: 230, health: 135, hpScale: 0.987101234208, hitScale: 1.0062460914 }, // intermediate_snowlands
  { damage: 1800, health: 200, hpScale: 0.990427788384, hitScale: 0.992662074027 }, // advanced_lava_wastes
  { damage: 2350, health: 210, hpScale: 1.0064224511, hitScale: 1.00773509489 }, // infernal_depths
  { damage: 1650, health: 320, hpScale: 0.989073258544, hitScale: 0.997536409466 }, // water_reach
  { damage: 1750, health: 360, hpScale: 1.00749273131, hitScale: 1.01087948371 }, // samurai_garden
  { damage: 1750, health: 360, hpScale: 0.999802828584, hitScale: 1.00220688105 }, // cloudspire
  { damage: 1800, health: 380, hpScale: 0.996118155428, hitScale: 1.00866498293 }, // moonfen
  { damage: 2250, health: 460, hpScale: 0.993402896154, hitScale: 0.999550177066 }, // crystal_hollows
  { damage: 2050, health: 510, hpScale: 1.00254382029, hitScale: 1.00172681266 }, // clockwork_ruins
  { damage: 2050, health: 520, hpScale: 0.997604919714, hitScale: 1.00530678806 }, // duskfall_orchard
  { damage: 2100, health: 540, hpScale: 0.990057682733, hitScale: 0.994066624655 }, // neon_bastion
  { damage: 2150, health: 560, hpScale: 0.990751685129, hitScale: 1.00405223979 }, // verdant_catacombs
  { damage: 2200, health: 560, hpScale: 0.990678825547, hitScale: 1.00065977419 }, // ion_citadel
  { damage: 2200, health: 1150, hpScale: 1.0095916754, hitScale: 1.01450412054 }, // endless_1
 ] as const;
export function bossBudgetScale(campaignIndex: number) {
  return BOSS_KILL_BUDGETS[campaignIndex] ?? { hpScale: 1, hitScale: 1 };
}
export function calibratedBossKillTarget(mapIndex: number) {
  if (mapIndex < 15) return BOSS_KILL_BUDGETS[Math.max(0, mapIndex)];
  const first = BOSS_KILL_BUDGETS[15];
  const number = mapIndex - 14;
  const scale = endlessScaling(number);
  const before = number === 1 ? 1 / 9.5 : (() => { const prev = endlessScaling(number - 1); return prev.combatStats * prev.endurance; })();
  const healthStep = scale.combatStats * scale.endurance - before;
  return { damage: Math.ceil(first.damage * healthStep / (1 - 1 / 9.5) / scale.rewards),
    health: Math.ceil(first.health * Math.sqrt(scale.combatStats)) };
}
