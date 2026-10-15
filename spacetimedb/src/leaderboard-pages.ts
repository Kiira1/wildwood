import { table, t } from "spacetimedb/server";
import { LEADERBOARD_AGE_FILTERS, LEADERBOARD_BOARDS, LEADERBOARD_PAGE_SIZE, leaderboardBoard, leaderboardWindowRanks, type LeaderboardBoard } from "../../shared/leaderboard-window";
import type { GameReducerContext, GameViewContext } from "./index";
import type { Identity } from "spacetimedb";

/**
 * The boards are stored as pages of 100 identities, keyed "board:page", and a
 * page is written only when its identities change. Most of a board is players
 * who have not played since the last snapshot, so most pages stay as they are.
 * A player's rank is their page and their place on it: player_leaderboard_standing
 * keeps the page per board, which changes only when they cross a page edge.
 * The per-player rank rows it replaced were rewritten whenever anyone above moved.
 */
export const leaderboardPageTables = {
  leaderboardRankPage: table({ public: false }, {
    key: t.string().primaryKey(), identities: t.array(t.identity()),
  }),
  /** Players on each board, keyed by its index in LEADERBOARD_BOARDS. */
  leaderboardSize: table({ public: false }, { id: t.u8().primaryKey(), total: t.u32() }),
  /**
   * What the snapshot sorts a player by, and the page they are on per board (1-based; 0 is not on it).
   * Only players who could have changed are recomputed (leaderboard-refresh.ts); everyone else is sorted from here.
   */
  leaderboardStanding: table({ name: "player_leaderboard_standing", public: false }, {
    identity: t.identity().primaryKey(), prestige: t.u32(), power: t.f64(), playedMicros: t.u64(), joinedAtMicros: t.u64(),
    pages: t.array(t.u32()),
  }),
  /** Players to recompute at the next snapshot although they are offline: they left, or something changed them. */
  leaderboardDirty: table({ name: "leaderboard_dirty", public: false }, { identity: t.identity().primaryKey() }),
  // Retired with the per-prestige-level boards (0.908); emptied by the first full snapshot and dropped in the next
  // release that breaks clients (docs/pending-client-break.md).
  leaderboardPosition: table({ public: false }, {
    identity: t.identity().primaryKey(), ranks: t.array(t.u32()),
  }),
  leaderboardPrestigePosition: table({ public: false }, {
    identity: t.identity().primaryKey(), prestige: t.u32(), ranks: t.array(t.u32()),
  }),
  leaderboardPrestigeRankPage: table({ public: false }, {
    key: t.string().primaryKey(), identities: t.array(t.identity()),
  }),
  leaderboardPrestigeSize: table({ public: false }, { prestige: t.u32().primaryKey(), total: t.u32() }),
};

export type Standing = { identity: Identity; prestige: number; power: number; playedMicros: bigint; joinedAtMicros: bigint; pages: number[] };
const DAY_MICROS = 86_400_000_000n;
const key = (standing: Standing) => standing.identity.toHexString();

/** Each board's players in order. Ties fall to the identity, so the order never flickers between snapshots. */
export function sortBoards(standings: readonly Standing[], nowMicros: bigint): Record<LeaderboardBoard, Standing[]> {
  const byIdentity = (a: Standing, b: Standing) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  const byPower = (a: Standing, b: Standing) => b.power - a.power || byIdentity(a, b);
  const byTime = (a: Standing, b: Standing) => (a.playedMicros > b.playedMicros ? -1 : a.playedMicros < b.playedMicros ? 1 : 0) || byIdentity(a, b);
  const time = [...standings].sort(byTime);
  const joinedWithin = (days: number) => (row: Standing) => nowMicros - row.joinedAtMicros < BigInt(days) * DAY_MICROS;
  const boards = {
    power: [...standings].sort(byPower),
    prestige: [...standings].sort((a, b) => b.prestige - a.prestige || byPower(a, b)),
    time,
  } as Record<LeaderboardBoard, Standing[]>;
  for (const filter of LEADERBOARD_AGE_FILTERS) if (filter.days) boards[filter.board] = time.filter(joinedWithin(filter.days));
  return boards;
}

/**
 * Writes the pages that changed and returns each player's page per board, in
 * LEADERBOARD_BOARDS order. Built once per snapshot, never in a viewer's request.
 */
export function writeLeaderboardPages(ctx: Pick<GameReducerContext, "db">, standings: readonly Standing[], nowMicros: bigint) {
  const boards = sortBoards(standings, nowMicros);
  const pages = new Map(standings.map(row => [key(row), LEADERBOARD_BOARDS.map(() => 0)]));
  const live = new Set<string>();
  for (const [index, board] of LEADERBOARD_BOARDS.entries()) {
    const rows = boards[board];
    for (let offset = 0, page = 0; offset < rows.length; offset += LEADERBOARD_PAGE_SIZE, page++) {
      const identities = rows.slice(offset, offset + LEADERBOARD_PAGE_SIZE).map(row => row.identity);
      for (const row of rows.slice(offset, offset + LEADERBOARD_PAGE_SIZE)) pages.get(key(row))![index] = page + 1;
      const pageKey = `${board}:${page}`;
      live.add(pageKey);
      const old = ctx.db.leaderboardRankPage.key.find(pageKey);
      if (!old) ctx.db.leaderboardRankPage.insert({ key: pageKey, identities });
      else if (old.identities.length !== identities.length || old.identities.some((id, i) => !id.equals(identities[i]))) {
        ctx.db.leaderboardRankPage.key.update({ key: pageKey, identities });
      }
    }
    const size = { id: index, total: rows.length };
    const oldSize = ctx.db.leaderboardSize.id.find(index);
    if (!oldSize) ctx.db.leaderboardSize.insert(size); else if (oldSize.total !== size.total) ctx.db.leaderboardSize.id.update(size);
  }
  for (const old of [...ctx.db.leaderboardRankPage.iter()]) if (!live.has(old.key)) ctx.db.leaderboardRankPage.key.delete(old.key);
  for (const old of [...ctx.db.leaderboardSize.iter()]) if (old.id >= LEADERBOARD_BOARDS.length) ctx.db.leaderboardSize.id.delete(old.id);
  return pages;
}

/** A player's rank on one board: their page, then their place on it. 0 is unranked. Two key lookups. */
export function leaderboardRank(ctx: Pick<GameViewContext, "db">, board: LeaderboardBoard, identity: Identity) {
  const page = ctx.db.leaderboardStanding.identity.find(identity)?.pages[LEADERBOARD_BOARDS.indexOf(board)] ?? 0;
  if (!page) return 0;
  const place = ctx.db.leaderboardRankPage.key.find(`${board}:${page - 1}`)?.identities.findIndex(id => id.equals(identity)) ?? -1;
  return place < 0 ? 0 : (page - 1) * LEADERBOARD_PAGE_SIZE + place + 1;
}

/**
 * A linked guest keeps its place until the next snapshot instead of dropping
 * off: its standing and its slot on every page move to the account in the same
 * transaction as its leaderboard entry. When the account had a standing of its
 * own, the guest's is dropped and the next snapshot ranks the merged player once.
 */
export function moveLeaderboardStanding(ctx: Pick<GameReducerContext, "db">, guest: Identity, account: Identity) {
  const standing = ctx.db.leaderboardStanding.identity.find(guest);
  if (!standing) return;
  ctx.db.leaderboardStanding.identity.delete(guest);
  if (ctx.db.leaderboardStanding.identity.find(account)) return;
  ctx.db.leaderboardStanding.insert({ ...standing, identity: account });
  for (const [index, board] of LEADERBOARD_BOARDS.entries()) {
    const page = standing.pages[index];
    const row = page ? ctx.db.leaderboardRankPage.key.find(`${board}:${page - 1}`) : null;
    if (row) ctx.db.leaderboardRankPage.key.update({ ...row, identities: row.identities.map(id => id.equals(guest) ? account : id) });
  }
}

type Viewer = Pick<GameViewContext, "db" | "sender">;

function readRanks(ctx: Viewer, board: LeaderboardBoard, ranks: number[]) {
  const pages = new Map<number, Identity[]>();
  return ranks.flatMap(rank => {
    const page = Math.floor((rank - 1) / LEADERBOARD_PAGE_SIZE);
    if (!pages.has(page)) pages.set(page, ctx.db.leaderboardRankPage.key.find(`${board}:${page}`)?.identities ?? []);
    const identity = pages.get(page)![(rank - 1) % LEADERBOARD_PAGE_SIZE];
    const entry = identity && ctx.db.leaderboardEntry.identity.find(identity);
    return entry ? [{ rank, entry }] : [];
  });
}

const boardTotal = (ctx: Viewer, board: LeaderboardBoard) => ctx.db.leaderboardSize.id.find(LEADERBOARD_BOARDS.indexOf(board))?.total ?? 0;

/** The top three and the hundred around the viewer: at most 104 entry lookups and four pages. */
export function readLeaderboardWindow(ctx: Viewer, requested: string) {
  const board = leaderboardBoard(requested);
  return readRanks(ctx, board, leaderboardWindowRanks(leaderboardRank(ctx, board, ctx.sender), boardTotal(ctx, board)));
}

/** Zero starts at the viewer; a later request is clamped to one page of ranks. */
function pageRanks(localRank: number, total: number, requestedStart: number, requestedCount: number) {
  const initial = requestedStart === 0;
  const startRank = initial ? Math.max(1, localRank - 50) : Math.max(1, Math.floor(requestedStart));
  const count = initial ? localRank > 0 ? 101 : 100 : Math.max(1, Math.min(LEADERBOARD_PAGE_SIZE, Math.floor(requestedCount)));
  const endRank = Math.min(total, initial && localRank > 0 ? localRank + 50 : startRank + count - 1);
  const ranks = initial ? leaderboardWindowRanks(localRank, total)
    : Array.from({ length: Math.max(0, endRank - startRank + 1) }, (_, index) => startRank + index);
  return { ranks, startRank, endRank };
}

/** Zero starts at the viewer; later requests read at most 100 ranks. */
export function readLeaderboardPage(ctx: Viewer, requested: string, requestedStart: number, requestedCount: number) {
  const board = leaderboardBoard(requested);
  const localRank = leaderboardRank(ctx, board, ctx.sender), total = boardTotal(ctx, board);
  const { ranks, startRank, endRank } = pageRanks(localRank, total, requestedStart, requestedCount);
  return { entries: readRanks(ctx, board, ranks), startRank, endRank, localRank, total };
}

/**
 * Tabs from before 0.908 ask for one prestige level's board. The per-level
 * boards are gone; they get the whole board until they reload.
 */
export function readPrestigeLeaderboardPage(ctx: Viewer, requested: string, _level: number, requestedStart: number, requestedCount: number) {
  return { ...readLeaderboardPage(ctx, requested, requestedStart, requestedCount), prestige: -1, levels: [] as number[] };
}

/** Where one player stands on a board, for the leaderboard's search. Rank 0 is unranked. */
export function findLeaderboardSpot(ctx: Pick<GameViewContext, "db">, requested: string, _prestige: number, identity: Identity) {
  return { rank: leaderboardRank(ctx, leaderboardBoard(requested), identity), prestige: -1 };
}
