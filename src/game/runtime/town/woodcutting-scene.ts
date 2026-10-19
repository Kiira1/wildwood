/**
 * What the world shows of the player's woodcutting, written by the woodcutting runtime (woodcutting-runtime.ts) and
 * read by the renderers, as miningScene is: the trees that are stumps for the player, the tree being chopped, how
 * far along, and the hatchet's swing.
 */
export const woodcuttingScene = {
  /** Trees the player felled that have yet to grow back for them. */
  felled: new Set<number>(),
  /** The tree being chopped, or null. */
  target: null as number | null,
  /** How far through felling it, 0 to 1. */
  progress: 0,
  /** Whether the hatchet is out: the player holds it instead of their weapon while chopping. */
  hatchetOut: false,
  /** The hatchet swing's clock, counting down like a weapon's attack clock (sword-swing.ts reads it). */
  swingClock: 0,
  /** Why the tree in reach is not being chopped, if it is not: no hatchet, its stand shut, or no bag room. */
  blocked: null as "hatchet" | "stand" | "bag" | null,
};

export function resetWoodcuttingScene() {
  woodcuttingScene.felled.clear();
  woodcuttingScene.target = null;
  woodcuttingScene.progress = 0;
  woodcuttingScene.hatchetOut = false;
  woodcuttingScene.swingClock = 0;
  woodcuttingScene.blocked = null;
}
