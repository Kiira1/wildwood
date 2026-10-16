import type { PlayerState } from "./types";

/** Moving up the screen, at least half as much as sideways: into a portal's front and out the back of the next. */
export function isHeadingUp(player: Pick<PlayerState, "moveX" | "moveY">) {
  const y = player.moveY ?? 0;
  return y < 0 && -y >= Math.abs(player.moveX ?? 0) * .5;
}
