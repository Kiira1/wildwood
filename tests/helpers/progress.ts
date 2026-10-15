import { readPlayerProgress } from "../../spacetimedb/src/wide-stats";

/** A save as the server reads it: player_progress with its bag (player_inventory), crit rating and full stats. */
export function progressOf(f: { db: any; ctx?: { sender: any } }, who: any = f.ctx?.sender) {
  return readPlayerProgress({ db: f.db }, who);
}
