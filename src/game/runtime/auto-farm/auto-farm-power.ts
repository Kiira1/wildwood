import { MAP_IDS as CAMPAIGN_MAP_IDS } from '../../../../shared/rules';
import { CURVE_STEPS } from '../../../../shared/curve-steps';
import { proceduralMapNumber } from '../../../../shared/procedural-maps';

/**
 * The power the Balance Lab expects a player to bring to each campaign map:
 * its entry build's power in one Lab campaign from a fresh character
 * (autofarm-sim/reference-builds.ts campaignReferenceBuilds, the build the
 * maps are tuned to; maps it never reaches carry on by the curve's power step),
 * on the game's balance (src/balance/game-balance.ts key
 * MAP_POWER_BALANCE). The game has no recommended power of its own; this is its
 * balance curve. Endless carries it on by the curve's per-map growth (endlessMapPower); the Soul Dimension's
 * enemies are sized to the player, so it has none. After a rebalance, regenerate it with
 * AUTOFARM_POWER_TABLE=1 npx vitest run src/game/runtime/auto-farm/auto-farm-power.test.ts
 */
export const MAP_POWER_BALANCE = 'curve-2.2-2.2-1.8-5';
export const MAP_ENTRY_POWER: Readonly<Record<string, number>> = {
  tutorial_forest: 105,
  beginner_desert: 3662,
  intermediate_snowlands: 13995,
  advanced_lava_wastes: 21060,
  infernal_depths: 33594,
  water_reach: 69977,
  samurai_garden: 159924,
  cloudspire: 1065129,
  moonfen: 1251636,
  crystal_hollows: 2456208,
  clockwork_ruins: 3748891,
  duskfall_orchard: 8347403,
  neon_bastion: 15182978,
  verdant_catacombs: 59877957,
  ion_citadel: 271238496,
};

/**
 * How much more power each Endless stage asks than the one before: the curve grows enemy health and hits by the
 * same step every map (shared/curve-steps.ts), and power counts damage and health alike.
 */
export const ENDLESS_STAGE_GROWTH = Math.sqrt(CURVE_STEPS.health * CURVE_STEPS.damage);
/** Endless N's recommended power: the last campaign map's, grown one Endless step per stage. */
export function endlessMapPower(number: number): number {
  return MAP_ENTRY_POWER[CAMPAIGN_MAP_IDS[CAMPAIGN_MAP_IDS.length - 1]] * ENDLESS_STAGE_GROWTH ** Math.max(1, number);
}

/** A map's recommended power: what Move On waits for before going there. Null where there is none (Endless, the Soul Dimension). */
export function recommendedMapPower(mapId: string): number | null {
  const endless = proceduralMapNumber(mapId);
  return endless !== null ? endlessMapPower(endless) : MAP_ENTRY_POWER[mapId] ?? null;
}

/**
 * A map's boss's recommended power: the power the Lab leaves the map with (the
 * next campaign map's entry), which is what the boss is sized for; the map's
 * own where there is no map after it. Null where the map has none.
 */
export function recommendedBossPower(mapId: string): number | null {
  // An Endless boss gates the next stage: it is sized for that stage's entry.
  const endless = proceduralMapNumber(mapId);
  if (endless !== null) return endlessMapPower(endless + 1);
  const index = CAMPAIGN_MAP_IDS.indexOf(mapId);
  if (index < 0) return null;
  // The last campaign map's boss opens Endless 1.
  return index === CAMPAIGN_MAP_IDS.length - 1 ? endlessMapPower(1) : MAP_ENTRY_POWER[CAMPAIGN_MAP_IDS[index + 1]] ?? recommendedMapPower(mapId);
}
