import {
  MINING_NODES, MINING_NODE_KINDS, MINING_REACH, MINING_VEINS, miningBreakSeconds, miningVeinMap, miningVeinOpen, type MiningNode,
} from "../../../../shared/mining";
import { REFINE_ORES } from "../../../../shared/refine";
import type { CampaignAccess } from "../../../../shared/equipment-access";
import { inTownHills, TOWN_FEET_OFFSET } from "../../../../shared/town";
import { ATTACK_ANIMATION_SECONDS } from "../../attack-timeline";
import type { PlayerState } from "../types";
import { miningScene, resetMiningScene } from "./mining-scene";
import { ORE_COLORS } from "./ore-rock-renderer";
import { bagFullForOres, rockOreKinds, roomForOres, type BagSpace } from "../../../../shared/ore-bag";

type Result = { ok: boolean; error?: string } | undefined;
type MiningBreak = { nodeId: number; starshard: boolean; rocksBroken: number };

/** What mining needs from the session (mining-service.ts on the coop API). */
export type MiningSource = {
  hasPickaxe?: () => boolean;
  mining?: () => number;
  minedNodeAt?: (nodeId: number) => number | null;
  mineNode?: (nodeId: number) => Promise<Result>;
  setOnMiningBreak?: (callback: ((result: MiningBreak) => void) | null) => void;
  serverNowMs?: () => number;
  savedProgress?: () => CampaignAccess | null | undefined;
};

/** A pickaxe swing this often while mining. */
const SWING_SECONDS = .7;
/** A hint (no pickaxe, a shut vein) says itself again only after this long, or for another rock. */
const HINT_SECONDS = 6;
/** How often the bare rocks are looked over: they only change as rocks grow back and break. */
const BARE_REFRESH_SECONDS = .5;
/** A rock broken here that the server has not listed is let go after its longest regrowth. */
const PENDING_LIMIT_MS = MINING_NODE_KINDS.mysterious.respawnSeconds * 1_000;

/**
 * Mining in play. Standing within reach of a rock with the Smith's pickaxe, the player swings at the nearest one
 * that is not bare until it breaks (shared/mining.ts times it by Mining), and the server is asked to take the
 * break; what it gave shows when the server's row says so. A rock broken here is bare at once, before the
 * server's word, and comes back if the server refuses. Walking pauses the swing; walking away, or to another
 * rock, starts the next one afresh. Without the pickaxe, at a vein not open yet, or with no bag slot for a kind
 * of ore not held yet, it says why instead.
 */
export function createMiningRuntime(deps: {
  source: () => MiningSource | null | undefined;
  player: PlayerState;
  message?: (text: string, color: string) => void;
  logPickup?: (label: string, color: string) => void;
  burst?: (x: number, y: number, color: string, count: number, speed: number) => void;
  /** The bag as the server counts it: a kind of ore not held yet needs a free slot (shared/ore-bag.ts). */
  bag?: () => BagSpace | null | undefined;
}) {
  let target: MiningNode | null = null;
  let elapsed = 0, swing = 0, bareCheck = 0, clock = 0;
  /** The rock whose break is with the server: nothing else is mined until it answers. */
  let sending: number | null = null;
  /** Rocks broken here, by when, that the server has yet to list. */
  const pending = new Map<number, number>();
  let hint = { text: "", at: -Infinity, rock: -1 };
  let listeningTo: MiningSource | null = null;

  const now = () => deps.source()?.serverNowMs?.() ?? Date.now();

  function isBare(node: MiningNode, at: number) {
    const brokenAt = deps.source()?.minedNodeAt?.(node.id) ?? pending.get(node.id) ?? null;
    return brokenAt !== null && at - brokenAt < MINING_NODE_KINDS[node.kind].respawnSeconds * 1_000;
  }

  function refreshBare(at: number) {
    for (const [id, brokenAt] of pending) if (at - brokenAt > PENDING_LIMIT_MS || deps.source()?.minedNodeAt?.(id) != null) pending.delete(id);
    miningScene.bare.clear();
    for (const node of MINING_NODES) if (isBare(node, at)) miningScene.bare.add(node.id);
    if (sending !== null) miningScene.bare.add(sending);
  }

  /** The nearest rock in reach of the player's feet that is not bare. */
  function rockInReach() {
    const feetX = deps.player.x, feetY = deps.player.y + TOWN_FEET_OFFSET;
    let best: MiningNode | null = null, bestDistance = MINING_REACH;
    for (const node of MINING_NODES) {
      if (miningScene.bare.has(node.id) || Math.abs(node.x - feetX) > MINING_REACH || Math.abs(node.y - feetY) > MINING_REACH) continue;
      const distance = Math.hypot(node.x - feetX, node.y - feetY);
      if (distance <= bestDistance) { best = node; bestDistance = distance; }
    }
    return best;
  }

  function stop() {
    target = null; elapsed = 0; swing = 0;
    miningScene.target = null; miningScene.progress = 0; miningScene.pickaxeOut = false; miningScene.swingClock = 0;
  }

  function say(text: string, color: string, rock: number) {
    if (text === hint.text && rock === hint.rock && clock - hint.at < HINT_SECONDS) return;
    hint = { text, at: clock, rock };
    deps.message?.(text, color);
  }

  /** What each break the server takes gave, over its rock. */
  function listen(source: MiningSource) {
    if (listeningTo === source || !source.setOnMiningBreak) return;
    listeningTo = source;
    source.setOnMiningBreak(result => {
      const node = MINING_NODES[result.nodeId];
      if (!node) return;
      const color = ORE_COLORS[node.ore].light;
      deps.logPickup?.(`+${MINING_NODE_KINDS[node.kind].ore} ${REFINE_ORES[node.ore].name}`, color);
      if (result.starshard) deps.logPickup?.("+1 Starshard", "#f6dcff");
      deps.burst?.(node.x, node.y - 24, color, 12, 95);
    });
  }

  function breakRock(source: MiningSource, rock: MiningNode, at: number) {
    const id = rock.id;
    sending = id;
    pending.set(id, at);
    miningScene.bare.add(id);
    stop();
    deps.burst?.(rock.x, rock.y - 18, "#c7ced3", 14, 120);
    void Promise.resolve(source.mineNode?.(id) ?? { ok: false, error: "Not Connected" }).then(result => {
      sending = null;
      if (result?.ok) return;
      // Refused: the rock was never broken, so it stands again.
      pending.delete(id);
      miningScene.bare.delete(id);
      deps.message?.(result?.error ?? "Not Connected", "#ff9b91");
    });
  }

  /** `active`: in the Town and free to act (not through a door, not falling down a well). */
  function update(dt: number, active: boolean) {
    clock += dt;
    const source = deps.source();
    const at = now();
    if ((bareCheck -= dt) <= 0) { bareCheck = BARE_REFRESH_SECONDS; refreshBare(at); }
    if (!active || !source || deps.player.hp <= 0 || !inTownHills(deps.player.x, deps.player.y, MINING_REACH * 2)) { stop(); return; }
    listen(source);
    const rock = sending === null ? rockInReach() : null;
    if (!rock) { stop(); return; }
    if (rock.id !== target?.id) { target = rock; elapsed = 0; swing = 0; }
    if (!source.hasPickaxe?.()) { stop(); say("You need a pickaxe. The Smith in Town has one.", "#ffd75e", rock.id); return; }
    const vein = MINING_VEINS[rock.vein];
    if (!miningVeinOpen(vein, source.savedProgress?.())) {
      stop();
      say(`Reach ${miningVeinMap(vein)} to mine ${REFINE_ORES[vein.ore].name}.`, "#ff9b91", rock.id);
      return;
    }
    // A full bag: told before the swing, not after the rock is broken.
    const space = deps.bag?.();
    if (space) {
      const { needed, room } = roomForOres(space, rockOreKinds(rock));
      if (!room) { stop(); say(bagFullForOres(needed), "#ff9b91", rock.id); return; }
    }
    const seconds = miningBreakSeconds(rock, source.mining?.() ?? 0);
    miningScene.target = rock.id;
    miningScene.pickaxeOut = true;
    miningScene.swingClock = Math.max(0, miningScene.swingClock - dt);
    // Walking pauses the swing; the progress made on this rock stays.
    if (deps.player.moving) { miningScene.progress = Math.min(1, elapsed / seconds); return; }
    elapsed += dt;
    if ((swing -= dt) <= 0) {
      swing = SWING_SECONDS;
      miningScene.swingClock = ATTACK_ANIMATION_SECONDS;
      deps.burst?.(rock.x, rock.y - 26, "#c7ced3", 3, 55);
    }
    miningScene.progress = Math.min(1, elapsed / seconds);
    if (elapsed >= seconds) breakRock(source, rock, at);
  }

  return {
    update,
    /** Leaves the hills behind: a map change or the session going. */
    reset() { stop(); resetMiningScene(); pending.clear(); sending = null; },
  };
}
