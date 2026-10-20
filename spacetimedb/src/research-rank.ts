import { table, t } from "spacetimedb/server";
import {
  RANK_TABLE_RESEARCH_IDS, rankTableRanksOf, type RankTableRanks, type RankTableResearchId,
} from "../../shared/research";
import type spacetimedbType from "./index";

/**
 * Research kept as one row per node a player has ranks in (RANK_TABLE_RESEARCH_IDS in shared/research.ts), so a new
 * node needs no new column: player_research and player_luck_research stay as they are. Private, read through the
 * caller's own view. No row is rank zero.
 */
export const playerResearchRank = table({ name: "player_research_rank", public: false }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  researchId: t.string(),
  rank: t.u32(),
});

export const researchRankKey = (identity: { toHexString(): string }, researchId: string) => `${identity.toHexString()}:${researchId}`;

/** A player's ranks in the rank-table research. */
export function rankTableRanksFor(ctx: any, identity: any): RankTableRanks {
  return rankTableRanksOf(ctx.db.playerResearchRank?.identity.filter(identity) ?? []);
}

/** One rank-table research's stored rank, read by its key alone. */
export function researchRankFor(ctx: any, identity: any, researchId: RankTableResearchId) {
  const row = ctx.db.playerResearchRank?.key.find(researchRankKey(identity, researchId));
  return row ? rankTableRanksOf([row])[researchId] : 0;
}

/** Stores a player's rank-table ranks; a rank of zero removes its row. */
export function writeRankTableRanks(ctx: any, identity: any, ranks: Partial<Record<string, unknown>>) {
  const next = rankTableRanksOf(RANK_TABLE_RESEARCH_IDS.map(researchId => ({ researchId, rank: ranks[researchId] })));
  for (const researchId of RANK_TABLE_RESEARCH_IDS) {
    const key = researchRankKey(identity, researchId), current = ctx.db.playerResearchRank.key.find(key), rank = next[researchId];
    if (!rank) { if (current) ctx.db.playerResearchRank.key.delete(key); }
    else if (!current) ctx.db.playerResearchRank.insert({ key, identity, researchId, rank });
    else if (current.rank !== rank) ctx.db.playerResearchRank.key.update({ ...current, rank });
  }
}

export function deleteRankTableResearch(ctx: any, identity: any) {
  for (const row of [...ctx.db.playerResearchRank.identity.filter(identity)]) ctx.db.playerResearchRank.key.delete(row.key);
}

/** The caller's own rank-table research. */
export function registerResearchRanks(spacetimedb: typeof spacetimedbType) {
  const myResearchRanks = spacetimedb.view({ name: "my_research_ranks", public: true }, t.array(playerResearchRank.rowType),
    (ctx: any) => [...ctx.db.playerResearchRank.identity.filter(ctx.sender)]);
  return { myResearchRanks };
}
