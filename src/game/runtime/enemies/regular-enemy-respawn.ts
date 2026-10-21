import type { SpawnSite } from "../../world";

export { REGULAR_ENEMY_RESPAWN_SECONDS } from "../../../../shared/rules";
import { REGULAR_ENEMY_RESPAWN_SECONDS } from "../../../../shared/rules";
import { enemyRespawnSecondsWithResearch } from "../../../../shared/utility-research";
import { respawnSecondsWithCards } from "../../../../shared/card-effects";

export type RegularEnemyRespawn = {
  respawnSeconds: () => number;
  schedule: (site: SpawnSite) => void;
};

/**
 * Owns regular-enemy respawn timing. Boss respawns remain server-owned and
 * never pass through this service.
 *
 * The clock is the map's tuned respawn after research, and nothing else.
 */
export function createRegularEnemyRespawn(
  getGameTime: () => number,
  respawnSpeedMultiplier = 1,
  baseRespawnSeconds = () => REGULAR_ENEMY_RESPAWN_SECONDS,
  enemyRespawnRank: () => number = () => 0,
  /** What Respawn cards add to how often enemies come back (card-effects.ts respawnSecondsWithCards). */
  cardRespawn: () => number = () => 0,
): RegularEnemyRespawn {
  const speedMultiplier = Number.isFinite(respawnSpeedMultiplier)
    ? Math.max(1, respawnSpeedMultiplier)
    : 1;

  function respawnSeconds() {
    return respawnSecondsWithCards(enemyRespawnSecondsWithResearch(baseRespawnSeconds() / speedMultiplier, enemyRespawnRank()), cardRespawn());
  }

  function schedule(site: SpawnSite) {
    site.alive = false;
    site.respawnAt = getGameTime() + respawnSeconds();
  }

  return { respawnSeconds, schedule };
}
