import { RESEARCH_DEFINITIONS } from "./research";

/** The shortest a rock or tree takes to grow back, as a share of its base time. */
export const GATHER_RESPAWN_FLOOR = .5;

/**
 * How long a rock or tree takes to grow back, in ms: its base time with Resource Respawn's percent a rank taken off,
 * never under GATHER_RESPAWN_FLOOR of it. The server's gather judge and the client's timers both read this.
 */
export function gatherRespawnMs(baseSeconds: number, rank: unknown) {
  const { maxRank, valuePerRank } = RESEARCH_DEFINITIONS.resourceRespawn;
  const ranks = Number.isFinite(rank) ? Math.min(maxRank, Math.max(0, Math.floor(Number(rank)))) : 0;
  return Math.round(baseSeconds * 1_000 * Math.max(GATHER_RESPAWN_FLOOR, 1 - ranks * valuePerRank / 100));
}
