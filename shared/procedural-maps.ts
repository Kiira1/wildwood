import { runtimeMapBalance } from "./map-balance-runtime";
import { defaultBalanceSettings, resolveMapBalance } from "./map-balance";
import type { MapBalanceSnapshot } from "./map-balance-types";
import type { ForestProgressionLane, RewardStat } from "./progression";
import { proceduralMapId, type GeneratedMap } from "./procedural-map-core";

export * from "./procedural-map-core";
const curveSnapshots = new Map<number, MapBalanceSnapshot>();
/** Endless N on the repo's balance: what a map shows before the server's snapshot is installed. */
function curveSnapshot(number: number) {
  let snapshot = curveSnapshots.get(number);
  if (!snapshot) {
    if (curveSnapshots.size >= 64) curveSnapshots.clear();
    snapshot = resolveMapBalance(proceduralMapId(number), defaultBalanceSettings(), 0);
    curveSnapshots.set(number, snapshot);
  }
  return snapshot;
}
/** A lane's numbers on Endless N: the installed snapshot's, else the curve's. `authored` skips the installed one. */
export function generatedEnemyStats(map: Pick<GeneratedMap, "number">, lane: ForestProgressionLane, authored = false) {
  const row = (!authored && runtimeMapBalance(proceduralMapId(map.number))?.lanes[lane]) || curveSnapshot(map.number).lanes[lane];
  return { ...row, reward: { ...row.reward } };
}
/** Endless N's boss: the installed snapshot's, else the curve's. Bosses pay nothing. */
export function generatedBossStats(map: Pick<GeneratedMap, "number">, authored = false) {
  const boss = (!authored && runtimeMapBalance(proceduralMapId(map.number))?.boss) || curveSnapshot(map.number).boss!;
  return { hp: boss.hp, damage: boss.damage, rewards: [] as { type: RewardStat; amount: number }[] };
}
