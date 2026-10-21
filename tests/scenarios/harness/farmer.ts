import { playAs } from "./game";
import type { ScenarioWorld } from "./server";

/** A player who has beaten the Dragon (Auto Farm unlocked), in the world; `stats` overrides the saved build. */
export async function farmer(world: ScenarioWorld, name = "Ann", stats: Record<string, unknown> = {}) {
  const player = world.join(name);
  player.patch("playerProgress", { desertUnlocked: true, ...stats });
  player.disconnect();
  const network = { down: false };
  const tab = await playAs(world, name, { refuse: () => network.down ? new Error("server unreachable") : null });
  return {
    tab, player, network,
    /** Other players see a farmer: the server holds the farm's puppet for them. */
    farming: () => Boolean(world.db.playerAutoFarmPuppet.identity.find(player.identity)),
    /** The stat group other players see it farm ("stat:health"), or null when it is not farming. */
    group: () => (world.db.playerAutoFarmPuppet.identity.find(player.identity)?.group as string | undefined) ?? null,
    /** Kills the server has accepted from this player. */
    kills: () => Number(world.db.playerLifetime.identity.find(player.identity)?.enemyKills ?? 0),
  };
}

/** A build that outlasts the Forest, so a minute of farming is a minute of kills. */
export const strong = { damage: 500, maxHp: 5_000 };
