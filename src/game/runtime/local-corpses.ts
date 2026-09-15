import { createRemoteCorpses } from "../../coop/services/remote-corpses";
import type { RemotePlayer } from "../../coop/contracts";
import type { PlayerDeathAnimationState } from "./player-death-animation";

/** Keep the local corpse separate from the living character after respawn. */
export function createLocalCorpses() {
  const bodies = createRemoteCorpses();
  let owner = "";
  function select(identity: string) {
    if (identity !== owner) { bodies.clear(); owner = identity; }
  }
  return {
    add(identity: string, mapId: string, player: RemotePlayer, death: PlayerDeathAnimationState, skinTone: number) {
      select(identity);
      bodies.add(player, { ...death, mapId }, skinTone);
    },
    players(identity: string, mapId: string, now: number, active: PlayerDeathAnimationState | null) {
      select(identity);
      // The local actor already draws the current fall; draw its snapshot after respawn.
      return bodies.players(mapId, now).filter(body => bodies.death(body.id, mapId, now)?.startedAtMs !== active?.startedAtMs);
    },
    death: bodies.death,
  };
}
