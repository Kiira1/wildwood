import {
  MINING_NODES, MINING_NODE_KINDS, MINING_REACH, canMineRock, miningBreakSeconds, miningRockHint, miningRockOre, type MiningNode,
} from "../../../../shared/mining";
import { REFINE_ORES } from "../../../../shared/refine";
import { inTownHills, TOWN_FEET_OFFSET } from "../../../../shared/town";
import { ATTACK_ANIMATION_SECONDS, ATTACK_WINDUP_SECONDS } from "../../attack-timeline";
import type { PlayerState } from "../types";
import { miningScene, resetMiningScene } from "./mining-scene";
import { ORE_COLORS } from "./ore-rock-renderer";
import { bagFullForOres, rockOreKinds, roomForOres, type BagSpace } from "../../../../shared/ore-bag";
import type { ToolId } from "../../../../shared/tools";

type Result = { ok: boolean; error?: string } | undefined;
type MiningBreak = { nodeId: number; starshard: boolean; rocksBroken: number };

/** What mining needs from the session (mining-service.ts on the coop API). */
export type MiningSource = {
  localIdentity?: () => string | undefined;
  sessionGeneration?: () => number;
  mining?: () => number;
  /** What the active cards add to mining speed (card-effects.ts), a fraction. */
  activeCardStats?: () => { miningSpeed: number };
  /** A tool's upgrades (shared/tools.ts): the pickaxe's speed, which the server's rate check uses too. */
  toolLevel?: (tool: ToolId) => number;
  minedNodeAt?: (nodeId: number) => number | null;
  mineNode?: (nodeId: number) => Promise<Result>;
  setOnMiningBreak?: (callback: ((result: MiningBreak) => void) | null) => void;
  serverNowMs?: () => number;
};

/** A pickaxe swing this often while mining. */
const SWING_SECONDS = .7;
/** How long a broken rock's full bar stays up, so the hit that breaks it is seen to fill it. */
const BROKEN_SHOW_SECONDS = .35;

/** How many hits break a rock that takes `seconds`: its time in swings, rounded up. */
export function miningHits(seconds: number) {
  return Math.max(1, Math.ceil(seconds / SWING_SECONDS - 1e-9));
}
/**
 * When hit `index` (from 0) lands, in seconds of mining the rock: a swing apart, the last just as the break is due
 * (the timing the server checks), and none before the first swing's windup.
 */
export function miningHitAt(seconds: number, index: number) {
  return Math.max(ATTACK_WINDUP_SECONDS, seconds - (miningHits(seconds) - 1 - index) * SWING_SECONDS);
}
/** A hint (Mining short of a rock, a full bag) says itself again only after this long, or for another rock. */
const HINT_SECONDS = 6;
/** How often the bare rocks are looked over: they only change as rocks grow back and break. */
const BARE_REFRESH_SECONDS = .5;
/** A rock broken here that the server has not listed is let go after its longest regrowth. */
const PENDING_LIMIT_MS = MINING_NODE_KINDS.mysterious.respawnSeconds * 1_000;

/**
 * Mining in play. Standing within reach of a rock with their pickaxe, the player swings at the nearest one
 * that is not bare until it breaks (shared/mining.ts times it by Mining; its bar steps once per hit), and the
 * server is asked to take the break; what it gave shows when the server's row says so. A rock broken here is bare at once, before the
 * server's word, and comes back if the server refuses. Walking pauses the swing; walking away, or to another
 * rock, starts the next one afresh. At a rock whose Mining mark is not reached yet (canMineRock), or with no bag
 * slot for a kind of ore not held yet, it says why instead.
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
  /** Seconds spent mining the target, its swings started and hits landed, and how long a broken rock's full bar has left. */
  let elapsed = 0, swung = 0, landed = 0, bareCheck = 0, clock = 0, brokenShown = 0;
  /** The rock whose break is with the server: nothing else is mined until it answers. */
  let sending: number | null = null;
  /** Rocks broken here, by when, that the server has yet to list. */
  const pending = new Map<number, number>();
  let hint = { text: "", at: -Infinity, rock: -1 };
  let listeningTo: MiningSource | null = null;
  /** Pending breaks and bare rocks belong to the account and connection that made them. */
  let session: { source: MiningSource; identity: string; generation: number } | null = null;

  const now = () => deps.source()?.serverNowMs?.() ?? Date.now();

  function sameSession(source: MiningSource | null | undefined) {
    return Boolean(source && session?.source === source
      && session.identity === (source.localIdentity?.() ?? "")
      && session.generation === (source.sessionGeneration?.() ?? 0));
  }

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
    target = null; elapsed = 0; swung = 0; landed = 0; brokenShown = 0; miningScene.blocked = null;
    miningScene.target = null; miningScene.progress = 0; miningScene.pickaxeOut = false; miningScene.swingClock = 0;
  }

  function reset() {
    stop(); resetMiningScene(); pending.clear(); sending = null;
    listeningTo?.setOnMiningBreak?.(null);
    listeningTo = null; session = null; bareCheck = 0;
    hint = { text: "", at: -Infinity, rock: -1 };
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
    const started = session;
    source.setOnMiningBreak(result => {
      if (session !== started || !sameSession(deps.source())) return;
      const node = MINING_NODES[result.nodeId];
      if (!node) return;
      const color = ORE_COLORS[node.ore].light;
      deps.logPickup?.(`+${miningRockOre(node)} ${REFINE_ORES[node.ore].name}`, color);
      if (result.starshard) deps.logPickup?.("+1 Starshard", "#f6dcff");
      deps.burst?.(node.x, node.y - 24, color, 12, 95);
    });
  }

  function breakRock(source: MiningSource, rock: MiningNode, at: number) {
    const id = rock.id;
    const started = session;
    sending = id;
    pending.set(id, at);
    miningScene.bare.add(id);
    stop();
    // The breaking hit fills the bar: it stays up a moment over the broken rock.
    Object.assign(miningScene, { target: id, progress: 1, pickaxeOut: true, swingClock: ATTACK_ANIMATION_SECONDS - ATTACK_WINDUP_SECONDS });
    brokenShown = BROKEN_SHOW_SECONDS;
    deps.burst?.(rock.x, rock.y - 18, "#c7ced3", 14, 120);
    void Promise.resolve(source.mineNode?.(id) ?? { ok: false, error: "Not Connected" }).then(result => {
      // A reply from before a reconnect or Reset Save must not clear a newer break.
      if (session !== started || !sameSession(deps.source())) return;
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
    if (!sameSession(source)) {
      reset();
      if (!source) return;
      session = { source, identity: source.localIdentity?.() ?? "", generation: source.sessionGeneration?.() ?? 0 };
    }
    const at = now();
    if ((bareCheck -= dt) <= 0) { bareCheck = BARE_REFRESH_SECONDS; refreshBare(at); }
    if (!active || !source || deps.player.hp <= 0 || !inTownHills(deps.player.x, deps.player.y, MINING_REACH * 2)) { stop(); return; }
    listen(source);
    // The broken rock's full bar, while it lasts; walking on ends it.
    if (brokenShown > 0) {
      brokenShown -= dt;
      miningScene.swingClock = Math.max(0, miningScene.swingClock - dt);
      if (brokenShown > 0 && !deps.player.moving) return;
      stop();
    }
    const rock = sending === null ? rockInReach() : null;
    if (!rock) { stop(); return; }
    if (rock.id !== target?.id) { target = rock; elapsed = 0; swung = 0; landed = 0; }
    // Deeper veins and crystal rocks ask for some Mining first.
    if (!canMineRock(rock, source.mining?.() ?? 0)) { stop(); miningScene.blocked = "vein"; say(miningRockHint(rock), "#ff9b91", rock.id); return; }
    // A full bag: told before the swing, not after the rock is broken.
    const space = deps.bag?.();
    if (space) {
      const { needed, room } = roomForOres(space, rockOreKinds(rock));
      if (!room) { stop(); miningScene.blocked = "bag"; say(bagFullForOres(needed), "#ff9b91", rock.id); return; }
    }
    const pickaxe = source.toolLevel?.("pickaxe") ?? 0;
    const seconds = miningBreakSeconds(rock, source.mining?.() ?? 0, source.activeCardStats?.().miningSpeed ?? 0, pickaxe), hits = miningHits(seconds);
    miningScene.target = rock.id;
    miningScene.toolLevel = pickaxe;
    miningScene.pickaxeOut = true;
    miningScene.swingClock = Math.max(0, miningScene.swingClock - dt);
    // Walking pauses the swing; the hits made on this rock stay.
    if (!deps.player.moving) {
      elapsed += dt;
      // Each swing starts a windup before its hit lands, so the bar steps as the pick meets the rock.
      if (swung < hits && elapsed >= miningHitAt(seconds, swung) - ATTACK_WINDUP_SECONDS) {
        swung++;
        miningScene.swingClock = ATTACK_ANIMATION_SECONDS;
      }
      while (landed < swung && elapsed >= miningHitAt(seconds, landed)) {
        landed++;
        deps.burst?.(rock.x, rock.y - 26, "#c7ced3", 3, 55);
      }
    }
    miningScene.progress = Math.min(1, landed / hits);
    if (elapsed >= seconds) breakRock(source, rock, at);
  }

  return {
    update,
    /** Clears this session's local mining and stops listening for its breaks. */
    reset,
  };
}
