export const LEADERBOARD_STATS = ["power", "damage", "health", "armor", "regen", "time"] as const;
export type LeaderboardStat = typeof LEADERBOARD_STATS[number];
export const LEADERBOARD_PAGE_SIZE = 100;
export function leaderboardStat(value: string): LeaderboardStat {
  if (!(LEADERBOARD_STATS as readonly string[]).includes(value)) throw new Error("Unknown leaderboard stat");
  return value as LeaderboardStat;
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
