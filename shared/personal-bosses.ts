import { runtimeMapBalance } from "./map-balance-runtime";
import { bossMapForKind, campaignBossDefinition } from "./campaign-combat";
import { proceduralMapCore, generatedBossStats, isProceduralMap, PROCEDURAL_BOSS_RESPAWN_SECONDS } from "./procedural-maps";

export function personalBossDefinition(mapId: string, authored = false) {
  const remote = !authored && runtimeMapBalance(mapId)?.boss;
  if (remote) return { kind: remote.kind, hp: remote.hp, respawnSeconds: remote.respawnSeconds };
  if (isProceduralMap(mapId)) return { kind: "procedural", hp: generatedBossStats(proceduralMapCore(mapId), authored).hp, respawnSeconds: PROCEDURAL_BOSS_RESPAWN_SECONDS };
  return campaignBossDefinition(mapId);
}
export { bossMapForKind };
