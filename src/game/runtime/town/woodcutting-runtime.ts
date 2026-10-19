import {
  WOOD_STANDS, WOOD_TREE_NODES, WOODCUTTING_LOGS, WOODCUTTING_REACH, WOODCUTTING_RESPAWN_SECONDS, woodcuttingChopSeconds, woodStandHint, woodStandOpen,
  type WoodTree,
} from "../../../../shared/woodcutting";
import { REFINE_ORES } from "../../../../shared/refine";
import type { CampaignAccess } from "../../../../shared/equipment-access";
import { inTownGrove, TOWN_FEET_OFFSET } from "../../../../shared/town";
import { bagFullForOres, roomForOres, type BagSpace } from "../../../../shared/ore-bag";
import { ATTACK_ANIMATION_SECONDS, ATTACK_WINDUP_SECONDS } from "../../attack-timeline";
import type { PlayerState } from "../types";
import { miningHitAt, miningHits } from "./mining-runtime";
import { resetWoodcuttingScene, woodcuttingScene } from "./woodcutting-scene";
import { LOG_COLORS } from "./wood-tree-renderer";

type Result = { ok: boolean; error?: string } | undefined;
type TreeChop = { treeId: number; treesChopped: number };

/** What woodcutting needs from the session (woodcutting-service.ts on the coop API). */
export type WoodcuttingSource = {
  localIdentity?: () => string | undefined;
  sessionGeneration?: () => number;
  hasHatchet?: () => boolean;
  woodcutting?: () => number;
  choppedTreeAt?: (treeId: number) => number | null;
  chopTree?: (treeId: number) => Promise<Result>;
  setOnTreeChopped?: (callback: ((result: TreeChop) => void) | null) => void;
  serverNowMs?: () => number;
  savedProgress?: () => CampaignAccess | null | undefined;
};

/** How long a felled tree's full bar stays up, so the hit that fells it is seen to fill it. */
const FELLED_SHOW_SECONDS = .35;
/** A hint (no hatchet, a shut stand) says itself again only after this long, or for another tree. */
const HINT_SECONDS = 6;
/** How often the stumps are looked over: they only change as trees grow back and fall. */
const STUMP_REFRESH_SECONDS = .5;
/** A tree felled here that the server has not listed is let go after its regrowth. */
const PENDING_LIMIT_MS = WOODCUTTING_RESPAWN_SECONDS * 1_000;
const CHIPS = "#d9b98a";

/**
 * Woodcutting in play, as mining is (mining-runtime.ts): standing within reach of a tree with the Smith's hatchet,
 * the player swings at the nearest one still standing until it falls (shared/woodcutting.ts times it by Woodcutting,
 * its bar stepping once per hit, a swing apart as the pickaxe's), and the server is asked to take the fall. A tree
 * felled here is a stump at once, before the server's word, and stands again if the server refuses. Walking pauses
 * the swing; without the hatchet, at a stand not open yet, or with no bag slot for a new kind of log, it says why.
 */
export function createWoodcuttingRuntime(deps: {
  source: () => WoodcuttingSource | null | undefined;
  player: PlayerState;
  message?: (text: string, color: string) => void;
  logPickup?: (label: string, color: string) => void;
  burst?: (x: number, y: number, color: string, count: number, speed: number) => void;
  /** The bag as the server counts it: a kind of log not held yet needs a free slot (shared/ore-bag.ts). */
  bag?: () => BagSpace | null | undefined;
}) {
  let target: WoodTree | null = null;
  let elapsed = 0, swung = 0, landed = 0, stumpCheck = 0, clock = 0, felledShown = 0;
  /** The tree whose fall is with the server: nothing else is chopped until it answers. */
  let sending: number | null = null;
  /** Trees felled here, by when, that the server has yet to list. */
  const pending = new Map<number, number>();
  let hint = { text: "", at: -Infinity, tree: -1 };
  let listeningTo: WoodcuttingSource | null = null;
  /** Pending falls and stumps belong to the account and connection that made them. */
  let session: { source: WoodcuttingSource; identity: string; generation: number; hatchet: boolean } | null = null;

  const now = () => deps.source()?.serverNowMs?.() ?? Date.now();

  function sameSession(source: WoodcuttingSource | null | undefined) {
    return Boolean(source && session?.source === source
      && session.identity === (source.localIdentity?.() ?? "")
      && session.generation === (source.sessionGeneration?.() ?? 0)
      && session.hatchet === Boolean(source.hasHatchet?.()));
  }

  function isFelled(tree: WoodTree, at: number) {
    const choppedAt = deps.source()?.choppedTreeAt?.(tree.id) ?? pending.get(tree.id) ?? null;
    return choppedAt !== null && at - choppedAt < WOODCUTTING_RESPAWN_SECONDS * 1_000;
  }

  function refreshStumps(at: number) {
    for (const [id, choppedAt] of pending) if (at - choppedAt > PENDING_LIMIT_MS || deps.source()?.choppedTreeAt?.(id) != null) pending.delete(id);
    woodcuttingScene.felled.clear();
    for (const tree of WOOD_TREE_NODES) if (isFelled(tree, at)) woodcuttingScene.felled.add(tree.id);
    if (sending !== null) woodcuttingScene.felled.add(sending);
  }

  /** The nearest standing tree in reach of the player's feet. */
  function treeInReach() {
    const feetX = deps.player.x, feetY = deps.player.y + TOWN_FEET_OFFSET;
    let best: WoodTree | null = null, bestDistance = WOODCUTTING_REACH;
    for (const tree of WOOD_TREE_NODES) {
      if (woodcuttingScene.felled.has(tree.id) || Math.abs(tree.x - feetX) > WOODCUTTING_REACH || Math.abs(tree.y - feetY) > WOODCUTTING_REACH) continue;
      const distance = Math.hypot(tree.x - feetX, tree.y - feetY);
      if (distance <= bestDistance) { best = tree; bestDistance = distance; }
    }
    return best;
  }

  function stop() {
    target = null; elapsed = 0; swung = 0; landed = 0; felledShown = 0; woodcuttingScene.blocked = null;
    woodcuttingScene.target = null; woodcuttingScene.progress = 0; woodcuttingScene.hatchetOut = false; woodcuttingScene.swingClock = 0;
  }

  function reset() {
    stop(); resetWoodcuttingScene(); pending.clear(); sending = null;
    listeningTo?.setOnTreeChopped?.(null);
    listeningTo = null; session = null; stumpCheck = 0;
    hint = { text: "", at: -Infinity, tree: -1 };
  }

  function say(text: string, color: string, tree: number) {
    if (text === hint.text && tree === hint.tree && clock - hint.at < HINT_SECONDS) return;
    hint = { text, at: clock, tree };
    deps.message?.(text, color);
  }

  /** What each fall the server takes gave, over its tree. */
  function listen(source: WoodcuttingSource) {
    if (listeningTo === source || !source.setOnTreeChopped) return;
    listeningTo = source;
    const started = session;
    source.setOnTreeChopped(result => {
      if (session !== started || !sameSession(deps.source())) return;
      const tree = WOOD_TREE_NODES[result.treeId];
      if (!tree) return;
      const color = LOG_COLORS[tree.log].face;
      deps.logPickup?.(`+${WOODCUTTING_LOGS} ${REFINE_ORES[tree.log].name}`, color);
      deps.burst?.(tree.x, tree.y - 30, color, 12, 95);
    });
  }

  function fell(source: WoodcuttingSource, tree: WoodTree, at: number) {
    const id = tree.id;
    const started = session;
    sending = id;
    pending.set(id, at);
    woodcuttingScene.felled.add(id);
    stop();
    // The felling hit fills the bar: it stays up a moment over the stump.
    Object.assign(woodcuttingScene, { target: id, progress: 1, hatchetOut: true, swingClock: ATTACK_ANIMATION_SECONDS - ATTACK_WINDUP_SECONDS });
    felledShown = FELLED_SHOW_SECONDS;
    deps.burst?.(tree.x, tree.y - 40, "#7fae5a", 16, 130);
    void Promise.resolve(source.chopTree?.(id) ?? { ok: false, error: "Not Connected" }).then(result => {
      // A reply from before a reconnect or Reset Save must not clear a newer fall.
      if (session !== started || !sameSession(deps.source())) return;
      sending = null;
      if (result?.ok) return;
      // Refused: the tree never fell, so it stands again.
      pending.delete(id);
      woodcuttingScene.felled.delete(id);
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
      session = { source, identity: source.localIdentity?.() ?? "", generation: source.sessionGeneration?.() ?? 0, hatchet: Boolean(source.hasHatchet?.()) };
    }
    const at = now();
    if ((stumpCheck -= dt) <= 0) { stumpCheck = STUMP_REFRESH_SECONDS; refreshStumps(at); }
    if (!active || !source || deps.player.hp <= 0 || !inTownGrove(deps.player.x, deps.player.y, WOODCUTTING_REACH * 2)) { stop(); return; }
    listen(source);
    if (felledShown > 0) {
      felledShown -= dt;
      woodcuttingScene.swingClock = Math.max(0, woodcuttingScene.swingClock - dt);
      if (felledShown > 0 && !deps.player.moving) return;
      stop();
    }
    const tree = sending === null ? treeInReach() : null;
    if (!tree) { stop(); return; }
    if (tree.id !== target?.id) { target = tree; elapsed = 0; swung = 0; landed = 0; }
    if (!source.hasHatchet?.()) { stop(); woodcuttingScene.blocked = "hatchet"; say("You need a hatchet. The Smith in Town has one.", "#ffd75e", tree.id); return; }
    const stand = WOOD_STANDS[tree.stand];
    if (!woodStandOpen(stand, source.savedProgress?.())) { stop(); woodcuttingScene.blocked = "stand"; say(woodStandHint(stand), "#ff9b91", tree.id); return; }
    // A full bag: told before the swing, not after the tree falls.
    const space = deps.bag?.();
    if (space) {
      const { needed, room } = roomForOres(space, [tree.log]);
      if (!room) { stop(); woodcuttingScene.blocked = "bag"; say(bagFullForOres(needed), "#ff9b91", tree.id); return; }
    }
    const seconds = woodcuttingChopSeconds(tree, source.woodcutting?.() ?? 0), hits = miningHits(seconds);
    woodcuttingScene.target = tree.id;
    woodcuttingScene.hatchetOut = true;
    woodcuttingScene.swingClock = Math.max(0, woodcuttingScene.swingClock - dt);
    // Walking pauses the swing; the hits made on this tree stay.
    if (!deps.player.moving) {
      elapsed += dt;
      if (swung < hits && elapsed >= miningHitAt(seconds, swung) - ATTACK_WINDUP_SECONDS) {
        swung++;
        woodcuttingScene.swingClock = ATTACK_ANIMATION_SECONDS;
      }
      while (landed < swung && elapsed >= miningHitAt(seconds, landed)) {
        landed++;
        deps.burst?.(tree.x, tree.y - 22, CHIPS, 4, 60);
      }
    }
    woodcuttingScene.progress = Math.min(1, landed / hits);
    if (elapsed >= seconds) fell(source, tree, at);
  }

  return {
    update,
    /** Clears this session's local woodcutting and stops listening for its falls. */
    reset,
  };
}
