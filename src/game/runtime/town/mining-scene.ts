/**
 * What the world shows of the player's mining, written by the mining runtime (mining-runtime.ts) and read by the
 * renderers, as soulWellFall is: the rocks that are bare for the player, the rock they are mining, how far along,
 * and their pickaxe's swing.
 */
export const miningScene = {
  /** Rocks the player broke that have yet to grow back for them. */
  bare: new Set<number>(),
  /** The rock being mined, or null. */
  target: null as number | null,
  /** How far through breaking it, 0 to 1. */
  progress: 0,
  /** Whether the pickaxe is out: the player holds it instead of their weapon while mining. */
  pickaxeOut: false,
  /** The pickaxe swing's clock, counting down like a weapon's attack clock (sword-swing.ts reads it). */
  swingClock: 0,
};

export function resetMiningScene() {
  miningScene.bare.clear();
  miningScene.target = null;
  miningScene.progress = 0;
  miningScene.pickaxeOut = false;
  miningScene.swingClock = 0;
}
