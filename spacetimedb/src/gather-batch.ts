import { SenderError } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import { GATHER_CLAIM_AHEAD_MS, GATHER_CLAIM_MAX_AGE_MS, GATHER_REPORT_MAX, type GatherClaim } from "../../shared/gather-batch";
import { bagSlotsWithOres, type OreCounts } from "../../shared/ore-bag";
import type { OreId } from "../../shared/refine";
import { TOWN_FEET_OFFSET } from "../../shared/town";
import { bagCapacityFor } from "./bag-capacity";
import { DOOR_POSITION_TOLERANCE, walkSpeedFor } from "./door-reach";
import { extraCopiesOf } from "./equipment-copies";
import { readPlayerProgress } from "./wide-stats";

/**
 * A batch of rock or tree breaks (report_mining, report_chopping), judged in the order the client made them. Each
 * claimed time is held between the last break the server took and now (a little past it for clock drift), so the
 * breaks never claim more time than really passed; then each break must be open at the skill so far, grown back since its last break, a full break's
 * time (with the usual slack) after the one before, within walking reach of where the server last heard the player,
 * and have bag room for a new kind. A break that fails is skipped and the rest are still judged.
 */

export type GatherRejection = "unknown" | "skill" | "growing" | "too-soon" | "reach" | "bag";
type GatherNode = { id: number; x: number; y: number };

export type GatherRules<Node extends GatherNode> = {
  node: (id: number) => Node | null;
  canWork: (node: Node, skill: number) => boolean;
  gain: (node: Node) => number;
  /** Seconds a break takes at this skill, with the tool and cards. */
  seconds: (node: Node, skill: number) => number;
  slack: number;
  respawnMs: (node: Node) => number;
  reach: number;
  kinds: (node: Node) => readonly OreId[];
};

export type GatherState = {
  nowMs: number;
  /** The last break the server took, or null before the first. */
  lastAtMs: number | null;
  skill: number;
  /** When the server has each node last broken, while it has a row. */
  brokenAtMs: ReadonlyMap<number, number>;
  /** Whether the player could have stood within `range` of this point at this time. */
  within: (point: { x: number; y: number }, atMs: number, range: number) => boolean;
  /** Ore kinds already held; a new kind needs one of the free slots, read only when one does. */
  held: ReadonlySet<OreId>;
  freeSlots: () => number;
};

export function judgeGatherBatch<Node extends GatherNode>(claims: readonly GatherClaim[], rules: GatherRules<Node>, state: GatherState) {
  const accepted: { node: Node; atMs: number }[] = [], rejected: { id: number; atMs: number; reason: GatherRejection }[] = [];
  const broken = new Map(state.brokenAtMs), held = new Set(state.held);
  let previous = state.lastAtMs, earliest = Math.max(state.lastAtMs ?? -Infinity, state.nowMs - GATHER_CLAIM_MAX_AGE_MS);
  let skill = state.skill, free: number | null = null;
  for (const claim of claims) {
    const atMs = Math.min(state.nowMs + GATHER_CLAIM_AHEAD_MS, Math.max(earliest, claim.atMs));
    const reject = (reason: GatherRejection) => { rejected.push({ id: claim.id, atMs, reason }); };
    const node = rules.node(claim.id);
    if (!node) { reject("unknown"); continue; }
    if (!rules.canWork(node, skill)) { reject("skill"); continue; }
    const brokenAt = broken.get(node.id);
    if (brokenAt !== undefined && atMs - brokenAt < rules.respawnMs(node)) { reject("growing"); continue; }
    if (previous !== null && atMs - previous < rules.seconds(node, skill) * rules.slack * 1_000) { reject("too-soon"); continue; }
    if (!state.within({ x: node.x, y: node.y - TOWN_FEET_OFFSET }, atMs, rules.reach)) { reject("reach"); continue; }
    const needed = [...new Set(rules.kinds(node))].filter(kind => !held.has(kind));
    if (needed.length) {
      free ??= state.freeSlots();
      if (needed.length > free) { reject("bag"); continue; }
      free -= needed.length;
      for (const kind of needed) held.add(kind);
    }
    accepted.push({ node, atMs });
    broken.set(node.id, atMs);
    previous = earliest = atMs;
    skill += rules.gain(node);
  }
  return { accepted, rejected, skill };
}

/** A report's breaks as claims, or a refusal when it is malformed. */
export function gatherClaims(entries: unknown, idField: string): GatherClaim[] {
  if (!Array.isArray(entries) || entries.length > GATHER_REPORT_MAX) throw new SenderError("That report is too long.");
  // A time that is not a number counts as now.
  return entries.map(entry => ({ id: Number(entry?.[idField]), atMs: Number.isFinite(Number(entry?.atMs)) ? Number(entry.atMs) : Infinity }));
}

export const millisOf = (at: { microsSinceUnixEpoch: bigint }) => Number(at.microsSinceUnixEpoch / 1_000n);

/**
 * Where the player could have been at a time: within a walk of where their last movement packet put them, at the
 * fastest speed the server accepts, as a door is judged (door-reach.ts). Speed is read only when a break is not
 * within plain reach of that point.
 */
export function gatherReach(ctx: any, player: { x: number; y: number; speed?: number; identity: Identity; mapId: string; lastInputAt?: { microsSinceUnixEpoch: bigint } },
  progress: () => any) {
  const motion = ctx.db.playerMotion.identity.find(player.identity);
  const anchor = motion && motion.mapId === player.mapId && [motion.x, motion.y].every(Number.isFinite)
    ? { x: motion.x, y: motion.y, atMs: millisOf(motion.lastInputAt) }
    : { x: player.x, y: player.y, atMs: player.lastInputAt ? millisOf(player.lastInputAt) : millisOf(ctx.timestamp) };
  let speed: number | null = null;
  return (point: { x: number; y: number }, atMs: number, range: number) => {
    const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
    if (distance <= range) return true;
    speed ??= walkSpeedFor(ctx, player, progress());
    return distance <= range + DOOR_POSITION_TOLERANCE + speed * Math.abs(atMs - anchor.atMs) / 1_000;
  };
}

/** Bag slots free for new kinds of ore, read from the saved progress only when asked. */
export function gatherFreeSlots(ctx: any, identity: Identity, ores: OreCounts, progress: () => any, inventoryForProgress?: (progress: any) => string[]) {
  return () => {
    const saved = progress();
    return bagCapacityFor(ctx, identity) - bagSlotsWithOres({
      owned: saved && inventoryForProgress ? inventoryForProgress(saved) : [], equipped: saved ? equippedFields(saved) : [],
      extraCopies: extraCopiesOf(ctx, identity).length, ores, capacity: 0,
    });
  };
}

/** The saved progress, read once however many checks ask for it. */
export function progressOnce(ctx: any, identity: Identity) {
  let read = false, saved: any = null;
  return () => {
    if (!read) { saved = readPlayerProgress(ctx, identity); read = true; }
    return saved;
  };
}

export const equippedFields = (progress: any): string[] =>
  [progress.equippedHead, progress.equippedChest, progress.equippedFeet, progress.equippedRightHand, progress.equippedLeftHand];

/** Rejections that an honest client does not make: worth a line in the log. */
export function logOddGatherRejections(kind: string, identity: Identity, rejected: readonly { reason: GatherRejection }[]) {
  const odd = rejected.filter(entry => entry.reason === "too-soon" || entry.reason === "reach" || entry.reason === "unknown");
  if (!odd.length) return;
  const counts: Record<string, number> = {};
  for (const entry of odd) counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
  console.warn(`${kind} report rejected breaks`, JSON.stringify({ identity: identity.toHexString(), ...counts }));
}
