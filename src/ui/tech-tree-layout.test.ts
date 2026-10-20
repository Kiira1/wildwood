import { describe, expect, it } from "vitest";
import { POWER_RESEARCH_IDS, UTILITY_RESEARCH_IDS, RESEARCH_RANK_BAND_COUNT, RESEARCH_DEFINITIONS } from "../../shared/research";
import { createTechTreeLayout } from "./tech-tree-layout";

describe("tech tree layout", () => {
  it("renders every technology as four separate five-rank nodes", () => {
    const layout = createTechTreeLayout();
    expect(layout.nodes).toHaveLength(POWER_RESEARCH_IDS.length * RESEARCH_RANK_BAND_COUNT);
    for (const researchId of POWER_RESEARCH_IDS) {
      const nodes = layout.nodes.filter((node) => node.researchId === researchId);
      expect(nodes).toHaveLength(RESEARCH_RANK_BAND_COUNT);
      expect(nodes.map((node) => node.endRank - node.startRank)).toEqual([5, 5, 5, 5]);
    }
    expect(new Set(layout.nodes.map((node) => node.id)).size).toBe(layout.nodes.length);
  });

  it("lays the utility tree out one node, then two, with each single node fed by the pair above", () => {
    const layout = createTechTreeLayout("utility");
    expect(layout.rows.map(row => row.map(node => node.id.replace("tech-utility-", "")))).toEqual([
      ["researchSpeed"],
      ["slotUpgradeSpeed", "enemyRespawn"],
      ["bossRespawn"],
      ["offlineWindow", "utilityMoveSpeed"],
      ["utilityAttackRange"],
      ["enemyRespawn-2", "critCap"],
      ["inventorySlots"],
      ["cardLuck", "gearLuck"],
      ["miningLuck", "resourceRespawn"],
      ["cardLuck-2", "skillLuck"],
      ["refineLuck"],
    ]);
    expect(layout.rows.map(row => row.length)).toEqual([1, 2, 1, 2, 1, 2, 1, 2, 2, 2, 1]);
    // Every utility technology appears, Enemy Respawn and Card Luck twice.
    expect(new Set(layout.nodes.map(node => node.researchId))).toEqual(new Set(UTILITY_RESEARCH_IDS));
    expect(layout.nodes.find(node => node.id === "tech-utility-enemyRespawn-2")).toMatchObject({ startRank: 5, endRank: 10 });
    expect(layout.nodes.find(node => node.id === "tech-utility-cardLuck")).toMatchObject({ startRank: 0, endRank: 5 });
    expect(layout.nodes.find(node => node.id === "tech-utility-cardLuck-2")).toMatchObject({ startRank: 5, endRank: 10 });
    for (const node of layout.nodes.filter(node => node.rankBandIndex === 0)) {
      expect(node.endRank).toBe(Math.min(5, RESEARCH_DEFINITIONS[node.researchId].maxRank));
    }
    expect(layout.paths).toEqual([
      ["tech-utility-researchSpeed", "tech-utility-slotUpgradeSpeed"],
      ["tech-utility-researchSpeed", "tech-utility-enemyRespawn"],
      ["tech-utility-slotUpgradeSpeed", "tech-utility-bossRespawn"],
      ["tech-utility-enemyRespawn", "tech-utility-bossRespawn"],
      ["tech-utility-bossRespawn", "tech-utility-offlineWindow"],
      ["tech-utility-bossRespawn", "tech-utility-utilityMoveSpeed"],
      ["tech-utility-offlineWindow", "tech-utility-utilityAttackRange"],
      ["tech-utility-utilityMoveSpeed", "tech-utility-utilityAttackRange"],
      ["tech-utility-utilityAttackRange", "tech-utility-enemyRespawn-2"],
      ["tech-utility-utilityAttackRange", "tech-utility-critCap"],
      ["tech-utility-enemyRespawn-2", "tech-utility-inventorySlots"],
      ["tech-utility-critCap", "tech-utility-inventorySlots"],
      ["tech-utility-inventorySlots", "tech-utility-cardLuck"],
      ["tech-utility-inventorySlots", "tech-utility-gearLuck"],
      ["tech-utility-cardLuck", "tech-utility-miningLuck"],
      ["tech-utility-gearLuck", "tech-utility-miningLuck"],
      ["tech-utility-cardLuck", "tech-utility-resourceRespawn"],
      ["tech-utility-gearLuck", "tech-utility-resourceRespawn"],
      ["tech-utility-miningLuck", "tech-utility-cardLuck-2"],
      ["tech-utility-miningLuck", "tech-utility-skillLuck"],
      ["tech-utility-cardLuck-2", "tech-utility-refineLuck"],
      ["tech-utility-skillLuck", "tech-utility-refineLuck"],
    ]);
    // Every line joins adjacent rows, and every single node below the top has two lines in.
    const rowByNode = new Map(layout.rows.flatMap((row, index) => row.map(node => [node.id, index] as const)));
    for (const [from, to] of layout.paths) expect(rowByNode.get(to)).toBe((rowByNode.get(from) ?? -1) + 1);
    for (const [index, row] of layout.rows.entries()) {
      if (index === 0 || row.length !== 1) continue;
      expect(layout.paths.filter(([, to]) => to === row[0].id).map(([from]) => from).sort())
        .toEqual(layout.rows[index - 1].map(node => node.id).sort());
    }
  });

  it("alternates one and two nodes through every tier", () => {
    const layout = createTechTreeLayout();
    expect(layout.rows.map((row) => row.length)).toEqual(
      Array.from({ length: RESEARCH_RANK_BAND_COUNT }, () => [1, 2, 1, 2, 1, 2]).flat(),
    );
  });

  it("connects every one-to-two and two-to-one adjacent row", () => {
    const layout = createTechTreeLayout();
    expect(layout.paths).toContainEqual(["tech-1-foraging", "tech-1-warcraft"]);
    expect(layout.paths).toContainEqual(["tech-1-foraging", "tech-1-moveSpeed"]);
    expect(layout.paths).toContainEqual(["tech-1-warcraft", "tech-1-vitality"]);
    expect(layout.paths).toContainEqual(["tech-1-moveSpeed", "tech-1-vitality"]);
    expect(layout.paths).toContainEqual(["tech-1-prosperity", "tech-1-criticalChance"]);
    expect(layout.paths).toContainEqual(["tech-1-prosperity", "tech-1-criticalDamage"]);
    expect(layout.paths).toContainEqual(["tech-1-criticalChance", "tech-2-foraging"]);
    expect(layout.paths).toContainEqual(["tech-1-criticalDamage", "tech-2-foraging"]);

    const rowByNode = new Map(layout.rows.flatMap((row, index) => row.map((node) => [node.id, index] as const)));
    for (const [from, to] of layout.paths) expect(rowByNode.get(to)).toBe((rowByNode.get(from) ?? -1) + 1);
  });
});
