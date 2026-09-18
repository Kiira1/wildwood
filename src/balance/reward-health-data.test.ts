import { describe, expect, it } from "vitest";
import { ENEMY_TYPES, type EnemyKind } from "../../shared/enemy-definitions";
import { enemyDefeatDefinition } from "../../shared/enemy-defeats";
import { personalBossDefinition } from "../../shared/personal-bosses";
import { generateMap, generatedBossStats, generatedEnemyStats } from "../../shared/procedural-maps";
import { DRAGON_REWARD_DAMAGE, FROSTCLAW_REWARD_ARMOR, MAP_IDS } from "../../shared/rules";
import { rewardHealthRows, rewardHealthCsv } from "./reward-health-data";

describe("reward per health graph source data", () => {
  it("includes every rewarded campaign species accepted by the server, without averaging", () => {
    const rows = rewardHealthRows();
    for (const mapId of MAP_IDS) {
      for (const enemy of Object.keys(ENEMY_TYPES) as EnemyKind[]) {
        const definition = enemyDefeatDefinition(mapId, enemy);
        const row = rows.find(row => row.mapId === mapId && row.enemy === enemy);
        if (!definition) { expect(row).toBeUndefined(); continue; }
        expect(row).toMatchObject({ kind: "regular", hp: ENEMY_TYPES[enemy].hp, stat: definition.reward.type,
          reward: definition.reward.amount, population: definition.population, ratio: definition.reward.amount / ENEMY_TYPES[enemy].hp });
      }
    }
    expect(rows.some(row => row.enemy === "Spitter")).toBe(true);
    expect(rows.find(row => row.enemy === "Needle")?.stat).toBe("speed");
    expect(rows.find(row => row.enemy === "King Slime")?.elite).toBe(true);
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
  });
  it("uses full boss HP and per-clear stat payouts separately", () => {
    const rows = rewardHealthRows();
    for (const mapId of MAP_IDS) {
      const boss = rows.filter(row => row.mapId === mapId && row.kind === "boss");
      expect(boss.length).toBeGreaterThan(0);
      for (const row of boss) {
        expect(row.hp).toBe(personalBossDefinition(mapId)!.hp);
        expect(row.ratio).toBe(row.reward / row.hp);
      }
    }
    expect(rows.find(row => row.mapId === MAP_IDS[0] && row.kind === "boss")?.reward).toBe(DRAGON_REWARD_DAMAGE);
    expect(rows.find(row => row.mapId === MAP_IDS[2] && row.kind === "boss" && row.stat === "armor")?.reward).toBe(FROSTCLAW_REWARD_ARMOR);
  });
  it.each([1, 2, 15, 40, 10000])("uses actual generated lanes and boss rewards for Endless %i", number => {
    const id = `endless_${number}` as const, map = generateMap(id);
    const rows = rewardHealthRows([id]);
    expect(rows.filter(row => row.kind === "regular").reduce((sum, row) => sum + row.population, 0)).toBe(map.camps.reduce((sum, camp) => sum + camp.count, 0));
    const regularDefinitions = map.camps.flatMap(camp => [generatedEnemyStats(map, camp.lane), ...(camp.stat === "damage" && camp.count > 6 ? [generatedEnemyStats(map, "Dread Warden")] : [])]);
    for (const definition of regularDefinitions) expect(rows).toContainEqual(expect.objectContaining({ hp: definition.hp, reward: definition.reward.amount, stat: definition.reward.type, kind: "regular" }));
    const boss = generatedBossStats(map);
    for (const reward of boss.rewards) expect(rows).toContainEqual(expect.objectContaining({ kind: "boss", hp: boss.hp, stat: reward.type, reward: reward.amount, ratio: reward.amount / boss.hp }));
    expect(rows.every(row => Number.isFinite(row.ratio) && row.ratio > 0)).toBe(true);
  });
  it("reveals the declining Endless reward efficiency", () => {
    const rows = rewardHealthRows(["endless_1", "endless_2", "endless_15", "endless_40"]);
    const bosses = rows.filter(row => row.kind === "boss" && row.stat === "damage");
    for (let index = 1; index < bosses.length; index++) {
      expect(bosses[index].hp).toBeGreaterThan(bosses[index - 1].hp);
      expect(bosses[index].reward).toBeGreaterThan(bosses[index - 1].reward);
      expect(bosses[index].ratio).toBeLessThan(bosses[index - 1].ratio);
    }
  });
  it("exports exact numbers and rejects unknown maps", () => {
    const row = rewardHealthRows(["tutorial_forest"])[0];
    expect(rewardHealthCsv([row])).toContain(`"${row.ratio}"`);
    expect(rewardHealthCsv([{ ...row, enemy: 'Test, "enemy"' }])).toContain('"Test, ""enemy"""');
    expect(() => rewardHealthRows(["missing"])).toThrow("Unknown combat map");
  });
});
