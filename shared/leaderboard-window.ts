/**
 * The boards. Power ranks everyone by power; Prestige by prestige level, power
 * breaking ties; Time Played by hours, over every account or only those that
 * joined in the last 30 or 7 days. Each is stored as pages of 100 identities
 * (spacetimedb/src/leaderboard-pages.ts).
 */
export const LEADERBOARD_BOARDS = ["power", "prestige", "time", "time-30d", "time-7d"] as const;
export type LeaderboardBoard = typeof LEADERBOARD_BOARDS[number];
/** The window's three tabs; Time Played picks one of its boards by account age. */
export const LEADERBOARD_TABS = ["power", "prestige", "time"] as const;
export type LeaderboardStat = typeof LEADERBOARD_TABS[number];
export const LEADERBOARD_AGE_FILTERS = [
  { board: "time", days: 0, label: "Any Account Age" },
  { board: "time-30d", days: 30, label: "Joined Last 30 Days" },
  { board: "time-7d", days: 7, label: "Joined Last 7 Days" },
] as const satisfies readonly { board: LeaderboardBoard; days: number; label: string }[];
export const LEADERBOARD_PAGE_SIZE = 100;
/** Dragon access is reset by prestige, but a prestige level proves the player beat it. */
export function leaderboardEligible(desertUnlocked: boolean | undefined, prestigeLevel: number | undefined): boolean {
  return Boolean(desertUnlocked || (prestigeLevel ?? 0) > 0);
}
/** A requested board. The stat boards a client before 0.908 asks for read the Power board. */
export function leaderboardBoard(value: string): LeaderboardBoard {
  if ((LEADERBOARD_BOARDS as readonly string[]).includes(value)) return value as LeaderboardBoard;
  if (["damage", "health", "armor", "regen"].includes(value)) return "power";
  throw new Error("Unknown leaderboard board");
}
export function leaderboardWindowRanks(rank: number, total: number) {
  const ranks = new Set<number>();
  for (let i = 1; i <= Math.min(3, total); i++) ranks.add(i);
  // A new character not in the periodic snapshot sees the first page.
  const start = rank > 0 ? Math.max(1, rank - 50) : 1;
  const end = Math.min(total, rank > 0 ? rank + 50 : 100);
  for (let i = start; i <= end; i++) ranks.add(i);
  return [...ranks].sort((a, b) => a - b);
}

export type LeaderboardPage<Entry> = {
  entries: Entry[];
  startRank: number;
  endRank: number;
  localRank: number;
  total: number;
};
