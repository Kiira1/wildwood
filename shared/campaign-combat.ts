import { CAMPAIGN_MAPS } from "./campaign-registry";
import * as camps from "./enemy-camps";
import designs from "./map-designs.json";
import { isProceduralMap } from "./procedural-map-core";
import { desertBossHealthAt } from "./progression";
import * as rules from "./rules";
// Campaign enemy counts and bosses with no balance lookups, so map-balance can use them.
// enemy-defeats and personal-bosses add the Endless and installed-balance cases.

const CAMPS: Record<string, readonly camps.SpawnCamp[]> = {
  tutorial_forest: camps.CAMPS, beginner_desert: camps.DESERT_CAMPS,
  intermediate_snowlands: camps.SNOW_CAMPS, advanced_lava_wastes: camps.LAVA_CAMPS,
  infernal_depths: camps.INFERNAL_CAMPS, water_reach: camps.WATER_CAMPS,
  samurai_garden: camps.SAMURAI_CAMPS, cloudspire: camps.CLOUDSPIRE_CAMPS,
  moonfen: camps.MOONFEN_CAMPS, crystal_hollows: camps.CRYSTAL_HOLLOWS_CAMPS,
  clockwork_ruins: camps.CLOCKWORK_RUINS_CAMPS, duskfall_orchard: camps.DUSKFALL_ORCHARD_CAMPS,
  neon_bastion: camps.NEON_BASTION_CAMPS, verdant_catacombs: camps.VERDANT_CATACOMBS_CAMPS,
  ion_citadel: camps.ION_CITADEL_CAMPS,
};
const campaignPopulations = new Map<string, Map<string, number>>();
export function campaignPopulation(mapId: string) {
  let populations = campaignPopulations.get(mapId);
  if (populations) return populations;
  const saved = (designs.maps as Record<string, { status: string; spawnCamps: camps.SpawnCamp[] }>)[mapId];
  const rows = saved?.status === "live" && saved.spawnCamps.length ? saved.spawnCamps : CAMPS[mapId];
  if (!rows) return null;
  populations = new Map();
  for (const camp of rows) for (let i = 0; i < camp.count; i++) {
    const kind = camp.types[i % camp.types.length];
    populations.set(kind, (populations.get(kind) ?? 0) + 1);
  }
  campaignPopulations.set(mapId, populations);
  return populations;
}
export function combatMap(mapId: string) { return CAMPAIGN_MAPS.some(map => map.id === mapId) || isProceduralMap(mapId); }

const BOSSES: Record<string, { kind: string; hp: number }> = Object.fromEntries(CAMPAIGN_MAPS.map((map, index) => [map.id, {
  kind: map.bossKind,
  hp: rules.BOSS_RULES[`${map.bossArt}_MAX_HP`] ?? desertBossHealthAt(Math.max(0, index - 1)),
}]));
/** A campaign map's boss as authored, or null. */
export function campaignBossDefinition(mapId: string) {
  const boss = BOSSES[mapId];
  return boss ? { ...boss, respawnSeconds: rules.BOSS_RESPAWN_SECONDS } : null;
}
export function bossMapForKind(kind: string) { return Object.keys(BOSSES).find(mapId => BOSSES[mapId].kind === kind) ?? ""; }
