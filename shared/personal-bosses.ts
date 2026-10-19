import { CAMPAIGN_MAPS } from "./campaign-registry";
import { desertBossHealthAt } from "./progression";
import { runtimeMapBalance } from "./map-balance-runtime";
import * as rules from "./rules";
import { proceduralMapCore, generatedBossStats, isProceduralMap, PROCEDURAL_BOSS_RESPAWN_SECONDS } from "./procedural-maps";

const BOSSES: Record<string, { kind: string; hp: number }> = Object.fromEntries(CAMPAIGN_MAPS.map((map, index) => [map.id, {
  kind: map.bossKind,
  hp: rules.BOSS_RULES[`${map.bossArt}_MAX_HP`] ?? desertBossHealthAt(Math.max(0, index - 1)),
}]));

export function personalBossDefinition(mapId: string, authored = false) {
  const remote = !authored && runtimeMapBalance(mapId)?.boss;
  if (remote) return { kind: remote.kind, hp: remote.hp, respawnSeconds: remote.respawnSeconds };
  if (isProceduralMap(mapId)) return { kind: "procedural", hp: generatedBossStats(proceduralMapCore(mapId), authored).hp, respawnSeconds: PROCEDURAL_BOSS_RESPAWN_SECONDS };
  const boss = BOSSES[mapId];
  return boss ? { ...boss, respawnSeconds: rules.BOSS_RESPAWN_SECONDS } : null;
}
export function bossMapForKind(kind: string) { return Object.keys(BOSSES).find(mapId => BOSSES[mapId].kind === kind) ?? ""; }
