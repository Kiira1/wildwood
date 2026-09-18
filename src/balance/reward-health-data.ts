import { ENEMY_TYPES, type RewardType } from "../../shared/enemy-definitions";
import { generateMap, generatedBossStats, isProceduralMap } from "../../shared/procedural-maps";
import { MAP_DISPLAY_NAMES, MAP_IDS } from "../../shared/rules";
import { createSpawnSites, type MapId } from "../game/world";
import { AUTHORED_MAPS } from "./stat-graph-data";

export const REWARD_STATS: readonly RewardType[] = ["damage", "health", "armor", "regen", "speed"];
export const REWARD_LABELS: Record<RewardType, string> = {
  damage: "Damage", health: "Health", armor: "Armor", regen: "Regeneration", speed: "Attack speed",
};
export const REWARD_COLORS: Record<RewardType, string> = {
  damage: "#cf453e", health: "#26834d", armor: "#3975c3", regen: "#9460bb", speed: "#a4770e",
};
export type RewardHealthRow = {
  id: string; enemyId: string; mapId: string; mapName: string; enemy: string;
  kind: "regular" | "boss"; elite: boolean; hp: number; stat: RewardType;
  reward: number; ratio: number; population: number;
};

/** One row per distinct enemy and stat payout, never a camp average or sum. */
export function rewardHealthRows(mapIds: readonly string[] = MAP_IDS): RewardHealthRow[] {
  const rows: RewardHealthRow[] = [];
  for (const mapId of mapIds) {
    const generated = isProceduralMap(mapId) ? generateMap(mapId) : null;
    const authored = AUTHORED_MAPS.find(map => map.id === mapId);
    if (!generated && !authored) throw new RangeError(`Unknown combat map: ${mapId}`);
    const mapName = generated?.name ?? MAP_DISPLAY_NAMES[mapId as keyof typeof MAP_DISPLAY_NAMES];
    const enemies = new Map<string, RewardHealthRow>();
    for (const site of createSpawnSites({ x: 4050, y: 4050 }, mapId as MapId)) {
      const enemy = site.definition ?? ENEMY_TYPES[site.type];
      const key = `${site.type}:${enemy.hp}:${enemy.reward.type}:${enemy.reward.amount}`;
      const existing = enemies.get(key);
      if (existing) { existing.population++; continue; }
      const enemyId = `${mapId}:${key}`;
      enemies.set(key, { id: enemyId, enemyId, mapId, mapName,
        enemy: generated ? `${site.campName} · ${site.type}` : site.type,
        kind: "regular", elite: !!enemy.elite, hp: enemy.hp, stat: enemy.reward.type,
        reward: enemy.reward.amount, ratio: enemy.reward.amount / enemy.hp, population: 1 });
    }
    rows.push(...enemies.values());
    const boss = generated ? generatedBossStats(generated) : null;
    const rewards = boss?.rewards ?? Object.entries(authored!.bossRewards).map(([type, amount]) => ({ type: type as RewardType, amount }));
    const enemyId = `${mapId}:boss`;
    const enemy = generated ? `Endless ${generated.number} boss` : authored!.bossKind === "spider" ? "Desert Scorpion" : authored!.bossKind.replace(/([A-Z])/g, " $1").replace(/^./, letter => letter.toUpperCase());
    for (const reward of rewards) {
      const hp = boss?.hp ?? authored!.bossMaxHp;
      rows.push({ id: `${enemyId}:${reward.type}`, enemyId, mapId, mapName, enemy, kind: "boss", elite: false,
        hp, stat: reward.type, reward: reward.amount, ratio: reward.amount / hp, population: 1 });
    }
  }
  return rows;
}

export function rewardHealthCsv(rows: readonly RewardHealthRow[]) {
  const quote = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
  return ["Map,Enemy,Kind,Stat,Health,Reward,Reward per HP,Population", ...rows.map(row =>
    [row.mapName, row.enemy, row.elite ? "elite" : row.kind, REWARD_LABELS[row.stat], row.hp, row.reward, row.ratio, row.population].map(quote).join(","))].join("\n");
}
