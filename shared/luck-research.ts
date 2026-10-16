import { LUCK_RESEARCH_IDS, RESEARCH_DEFINITIONS, type LuckResearchId } from "./research";

export type LuckRanks = Record<LuckResearchId, number>;

/** What a luck research multiplies its chance by: 1 at rank zero, its percent a rank on top. */
export function luckMultiplier(researchId: LuckResearchId, rank: unknown) {
  const { maxRank, valuePerRank } = RESEARCH_DEFINITIONS[researchId];
  const ranks = Number.isFinite(rank) ? Math.min(maxRank, Math.max(0, Math.floor(Number(rank)))) : 0;
  return 1 + ranks * valuePerRank / 100;
}

/** A chance raised by luck, never past certainty. */
export function chanceWithLuck(chance: number, researchId: LuckResearchId, rank: unknown) {
  return Math.min(1, Math.max(0, chance) * luckMultiplier(researchId, rank));
}

export function emptyLuckRanks(): LuckRanks {
  return Object.fromEntries(LUCK_RESEARCH_IDS.map(id => [id, 0])) as LuckRanks;
}

/** The luck columns of any row, missing ones at zero. */
export function luckRanksOf(row: Partial<Record<string, unknown>> | null | undefined): LuckRanks {
  return Object.fromEntries(LUCK_RESEARCH_IDS.map(id => [id, Number(row?.[id] ?? 0) || 0])) as LuckRanks;
}
