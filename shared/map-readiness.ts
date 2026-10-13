import { damageAfterArmor } from "./combat";
import type { MapBalanceSnapshot } from "./map-balance-types";
import { offlineEnemyRoster } from "./offline-progress";
import { critPowerFactor, type PlayerPowerStats } from "./player-power";
import { CHALLENGE_ABSOLUTE_MIN_INTERVAL } from "./prestige-challenge";

/**
 * Whether a build is ready for a map or a boss, read from its live enemies (Ryan, 0.901.65: "i dont want move
 * on to use a fixed table"). It replaced a table of the power the Balance Lab brought to each map, which went
 * stale with every retune and never counted crit. Two questions, each with the enemy `margin` times as strong
 * (Move At, Fight At): does the build kill one fast enough, and can it take enough of its hits?
 */
export type Readiness = { ready: boolean; needs: "damage" | "health" | "both" | null };

/**
 * The limits for a map's regular enemies. fightSeconds: an average enemy dies within this long. hits: the build
 * takes this many of an average enemy's hits (after armor) before dying, or out-heals them. A boss is played
 * out instead (boss-readiness.ts).
 */
export const READINESS_LIMITS = { fightSeconds: 8, hits: 6 };

/** Damage a second as a fight sees it: the average hit, crits in, at the attack interval. */
export function readinessDps(stats: PlayerPowerStats) {
  return stats.damage * critPowerFactor(stats) / Math.max(CHALLENGE_ABSOLUTE_MIN_INTERVAL, stats.attackRate);
}

export function verdict(fightSeconds: number, hits: number, fightLimit: number, hitsLimit: number): Readiness {
  const damage = !(fightSeconds <= fightLimit), health = !(hits >= hitsLimit);
  return { ready: !damage && !health, needs: damage && health ? "both" : damage ? "damage" : health ? "health" : null };
}

/** Ready for a map's regular enemies, or null when it has none (a town, the Soul Dimension's sized-to-you camps). */
export function mapReadiness(mapId: string, stats: PlayerPowerStats, balance: MapBalanceSnapshot | undefined, margin = 1): Readiness | null {
  const roster = offlineEnemyRoster(mapId, balance);
  const population = roster.reduce((sum, entry) => sum + entry.population, 0);
  if (!population) return null;
  const scale = Math.max(1e-6, Number.isFinite(margin) ? margin : 1);
  const dps = readinessDps(stats);
  const mean = (value: (entry: (typeof roster)[number]) => number) => roster.reduce((sum, entry) => sum + entry.population * value(entry), 0) / population;
  const fightSeconds = dps > 0 ? mean(entry => entry.hp) * scale / dps : Infinity;
  const hit = mean(entry => damageAfterArmor(entry.damage * scale, stats.armor));
  const incoming = mean(entry => damageAfterArmor(entry.damage * scale, stats.armor) * entry.attacksPerSecond);
  const hits = stats.regen >= incoming || hit <= 0 ? Infinity : stats.maxHp / hit;
  return verdict(fightSeconds, hits, READINESS_LIMITS.fightSeconds, READINESS_LIMITS.hits);
}
