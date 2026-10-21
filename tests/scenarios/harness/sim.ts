import { afterEach } from "vitest";
import { createVirtualPlayer, type VirtualPlayerProfile } from "../../../src/game/runtime/auto-farm/autofarm-sim/virtual-player";
import { DEFAULT_ATTACK_INTERVAL, PLAYER_BASE_DAMAGE, PLAYER_BASE_HP, PLAYER_BASE_REGEN } from "../../../shared/rules";

/**
 * A headless player: the game's own frame step (combat, enemy AI, bosses,
 * travel, autofarm) with seeded clocks and no renderer, DOM or network. What
 * the server owns (unlocks on a boss kill, the death screen's respawn) is
 * stood in for by the virtual player. Fast: minutes of play in a second.
 */
const live = new Set<{ dispose: () => void }>();
afterEach(() => { for (const player of live) player.dispose(); live.clear(); });

/** A new character on the Forest with base stats and the starter bow, unless the profile says otherwise. */
export function simPlayer(profile: Partial<VirtualPlayerProfile> = {}, options: Parameters<typeof createVirtualPlayer>[1] = {}) {
  const player = createVirtualPlayer({
    name: "sim", seed: 1, startMap: "tutorial_forest", highestUnlocked: 0, weapon: "starter_bow",
    push: "normal", advance: false, economy: false,
    base: { damage: PLAYER_BASE_DAMAGE, maxHp: PLAYER_BASE_HP, armor: 0, regen: PLAYER_BASE_REGEN, attackRate: DEFAULT_ATTACK_INTERVAL },
    ...profile,
  }, { memoryOnSimClock: true, ...options });
  live.add(player);
  const { parts } = player;
  return Object.assign(player, {
    /** The same browser loads the game again: its storage kept, the clock where this one is. */
    reload: (next: Partial<VirtualPlayerProfile> = {}) => { player.dispose(); return simPlayer({ ...profile, ...next }, { storage: parts.storage, startMs: parts.clock.ms }); },
    /** Plays `seconds` with nobody at the keys (autofarm off unless `autofarm`). */
    play: (seconds: number, options: { autofarm?: boolean } = {}) => player.run(seconds, undefined, { autofarm: options.autofarm ?? false }),
    /** Holds a direction for `seconds`, then lets go. */
    async walk(x: number, y: number, seconds: number) {
      parts.setInput(x, y);
      try { return await player.run(seconds, undefined, { autofarm: false }); } finally { parts.setInput(0, 0); }
    },
    /** The living enemies, nearest first. */
    enemiesNear() {
      const p = parts.player;
      return parts.enemies.filter(enemy => !enemy.dead).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    },
  });
}
export type SimPlayer = ReturnType<typeof simPlayer>;
