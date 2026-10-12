// Movement reducer bodies: the requested speed (validated against the
// player's own effective speed as a ceiling) and which remote players a client wants
// motion for. The declarations stay in index.ts.
import type { ModuleReducerCtx } from "./index";
import { blockedSession, requireControllingPlayer } from "./session-guards";
import { SenderError } from "spacetimedb/server";
import { PLAYER_MOTION_INTEREST_LIMIT } from "../../shared/player-motion-interest";
import { ensureMotionDetailFrameSchedule, syncPlayerMotionIdentity, playerWithMotion } from "./presence-runtime";
import { movementSpeedsMatch, effectivePlayerMovementSpeed, MOVEMENT_SPEED_EPSILON } from "../../shared/rules";
import { readPlayerProgress } from "./wide-stats";
import { equippedFeetForProgress } from "./progress-helpers";
import { effectiveMovementSpeedForProgress } from "./player-speed";
import { BLACK_BOOTS, BLACK_BOOTS_SPEED_BONUS } from "../../shared/items";
import { updateSnapshotRow } from "./snapshot-row-writes";

export function setMotionInterest(ctx: ModuleReducerCtx, { networkIds }: { networkIds: number[] }) {
  if (blockedSession(ctx)) return;
  const activePlayer = requireControllingPlayer(ctx);
  const ownMotion = ctx.db.playerMotion.identity.find(ctx.sender);
  if (!ownMotion) throw new SenderError("Player motion is unavailable.");
  if (!ownMotion.isVisible) {
    if (ctx.db.playerMotionInterest.identity.find(ctx.sender)) ctx.db.playerMotionInterest.identity.delete(ctx.sender);
    return;
  }
  const selected: number[] = [];
  const seen = new Set<number>();
  for (const networkId of networkIds.slice(0, PLAYER_MOTION_INTEREST_LIMIT * 4)) { // A longer list is cut, not walked: each id costs a lookup.
    if (selected.length >= PLAYER_MOTION_INTEREST_LIMIT) break;
    if (seen.has(networkId) || networkId === ownMotion.networkId) continue;
    seen.add(networkId);
    const motion = ctx.db.playerMotion.networkId.find(networkId);
    if (!motion || !motion.isVisible || motion.mapId !== activePlayer.mapId) continue;
    selected.push(networkId);
  }

  const current = ctx.db.playerMotionInterest.identity.find(ctx.sender);
  if (selected.length === 0) {
    if (current) ctx.db.playerMotionInterest.identity.delete(ctx.sender);
    return;
  }
  if (
    current &&
    current.networkIds.length === selected.length &&
    current.networkIds.every((networkId: number, index: number) => networkId === selected[index])
  ) return;
  const next = { identity: ctx.sender, networkIds: selected };
  if (current) ctx.db.playerMotionInterest.identity.update(next);
  else ctx.db.playerMotionInterest.insert(next);
  ensureMotionDetailFrameSchedule(ctx);
}

export function setPlayerSpeed(ctx: ModuleReducerCtx, { speed }: { speed: number }) {
  if (blockedSession(ctx)) return;
  const current = requireControllingPlayer(ctx);
  if (movementSpeedsMatch(speed, current.speed)) return;

  // Speed remains server-authoritative. Move Speed research is a legitimate
  // client-side movement multiplier, so validate its exact server record
  // instead of treating every researched speed as a malformed packet.
  const progress = readPlayerProgress(ctx, ctx.sender);
  const research = ctx.db.playerResearch.identity.find(ctx.sender);
  const feet = progress ? equippedFeetForProgress(progress) : current.feetItem;
  const bootsEquipped = false;
  const moveSpeedRank = research?.moveSpeed ?? 0;
  const expectedSpeed = progress ? effectiveMovementSpeedForProgress(ctx, progress, research)
    : effectivePlayerMovementSpeed(bootsEquipped, moveSpeedRank, 0, research?.utilityMoveSpeed ?? 0);
  // Regular-enemy combat runs locally. Permit its two exact movement states,
  // while checking ownership/equipment here and never saving a temporary bonus.
  const blackBootsEquipped = progress && feet === BLACK_BOOTS;
  const restingSpeed = expectedSpeed + (blackBootsEquipped ? BLACK_BOOTS_SPEED_BONUS : 0);
  // Bound the maximum rather than demanding one of two exact values. A Move
  // Speed rank that has just finished leaves the client a beat behind: its
  // next packet still carries the previous rank's speed, which is lower than
  // the server now expects, and every rejection on live was exactly that.
  // Asking to move slower than you are entitled to is not an exploit.
  const maximumSpeed = Math.max(expectedSpeed, restingSpeed);
  if (!Number.isFinite(speed) || speed < 0 || speed > maximumSpeed + MOVEMENT_SPEED_EPSILON) {
    // Name the account in the log; the message alone says nothing about who
    // sent it. The player-facing text stays put so the error still groups.
    console.warn("Unsupported player speed", JSON.stringify({ identity: ctx.sender.toHexString(), speed, expectedSpeed, restingSpeed, maximumSpeed, feet, moveSpeedRank }));
    throw new SenderError("Unsupported player speed");
  }

  const nextPlayer = {
    ...current,
    speed,
    lastInputAt: ctx.timestamp,
  };
  updateSnapshotRow(ctx, "player", nextPlayer);
  syncPlayerMotionIdentity(ctx, playerWithMotion(ctx, nextPlayer));
}
