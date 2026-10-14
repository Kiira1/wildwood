import {
  RESEARCH_RANK_BAND_COUNT,
  RESEARCH_DEFINITIONS,
  UTILITY_RESEARCH_IDS,
  researchRankBandEnd,
  researchRankBandStart,
  type ResearchId,
  type ResearchTree,
} from "../../shared/research";

export type TechTreeNode = {
  id: string;
  researchId: ResearchId;
  rankBandIndex: number;
  startRank: number;
  endRank: number;
};

export type TechTreeLayout = {
  rows: TechTreeNode[][];
  nodes: TechTreeNode[];
  paths: Array<[string, string]>;
};

const TECH_TREE_ROWS: ResearchId[][] = [
  ["foraging"],
  [
    "warcraft",
    "moveSpeed",
  ],
  ["vitality"],
  [
    "precision",
    "regeneration",
  ],
  ["prosperity"],
  [
    "criticalChance",
    "criticalDamage",
  ],
];

function nodeId(researchId: ResearchId, rankBandIndex: number) {
  return `tech-${rankBandIndex + 1}-${researchId}`;
}

export function createTechTreeLayout(tree: ResearchTree = "power"): TechTreeLayout {
  if (tree === "utility") {
    const node = (researchId: typeof UTILITY_RESEARCH_IDS[number], rankBandIndex = 0): TechTreeNode => ({
      id: `tech-utility-${researchId}${rankBandIndex ? `-${rankBandIndex + 1}` : ""}`, researchId, rankBandIndex,
      startRank: researchRankBandStart(researchId, rankBandIndex),
      endRank: Math.min(RESEARCH_DEFINITIONS[researchId].maxRank, researchRankBandEnd(researchId, rankBandIndex)),
    });
    const rows: TechTreeNode[][] = [
      [node("researchSpeed")],
      [node("slotUpgradeSpeed"), node("enemyRespawn")],
      [node("bossRespawn")],
      [node("offlineWindow"), node("utilityMoveSpeed")],
      [node("utilityAttackRange")],
      // Both hang behind Attack Range: Enemy Respawn's second band and Crit Cap.
      [node("enemyRespawn", 1), node("critCap")],
      // Also behind Attack Range, in a row of its own: a row holds two nodes at most.
      [node("inventorySlots")],
    ];
    // Each line runs from a node's real prerequisites, so a node two rows down is not drawn behind the row between.
    const paths: TechTreeLayout["paths"] = [];
    for (const to of rows.flat()) {
      const definition = RESEARCH_DEFINITIONS[to.researchId];
      const from = to.rankBandIndex > 0 ? Object.keys(definition.laterBandPrerequisites ?? {})
        : [...Object.keys(definition.prerequisites ?? {}), ...(definition.prerequisiteAny ?? [])];
      for (const id of from) paths.push([`tech-utility-${id}`, to.id]);
    }
    return { rows, nodes: rows.flat(), paths };
  }
  const rows: TechTreeNode[][] = [];
  const paths: Array<[string, string]> = [];
  for (let rankBandIndex = 0; rankBandIndex < RESEARCH_RANK_BAND_COUNT; rankBandIndex += 1) {
    rows.push(...TECH_TREE_ROWS.map((row) => row.map((researchId) => ({
      id: nodeId(researchId, rankBandIndex),
      researchId,
      rankBandIndex,
      startRank: researchRankBandStart(researchId, rankBandIndex),
      endRank: researchRankBandEnd(researchId, rankBandIndex),
    }))));
    const path = (from: ResearchId, to: ResearchId) => paths.push([
      nodeId(from, rankBandIndex),
      nodeId(to, rankBandIndex),
    ]);
    path("foraging", "warcraft");
    path("foraging", "moveSpeed");
    path("warcraft", "vitality");
    path("moveSpeed", "vitality");
    path("vitality", "precision");
    path("vitality", "regeneration");
    path("precision", "prosperity");
    path("regeneration", "prosperity");
    path("prosperity", "criticalChance");
    path("prosperity", "criticalDamage");
    if (rankBandIndex > 0) {
      paths.push(
        [nodeId("criticalChance", rankBandIndex - 1), nodeId("foraging", rankBandIndex)],
        [nodeId("criticalDamage", rankBandIndex - 1), nodeId("foraging", rankBandIndex)],
      );
    }
  }

  return { rows, nodes: rows.flat(), paths };
}
