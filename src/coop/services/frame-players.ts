import type { RemotePlayer } from "../contracts";

/** Callers this close together are one frame: render and each simulation step of it. */
const FRAME_PLAYERS_REUSE_MS = 4;

/**
 * One build of the other players per frame for every caller: a build sorts and walks every player and
 * Auto Farm puppet, and a slow frame ran up to eight simulation steps, each building again.
 */
export function createFramePlayers(build: () => RemotePlayer[], now = () => performance.now()) {
  let builtAt = -Infinity, players: RemotePlayer[] = [];
  return () => {
    const at = now();
    if (at - builtAt >= FRAME_PLAYERS_REUSE_MS || at < builtAt) { builtAt = at; players = build(); }
    return players;
  };
}
