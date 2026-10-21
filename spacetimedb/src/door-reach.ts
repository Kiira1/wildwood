import { doorDestinationWithin } from "../../shared/door-reach";
import { BLACK_BOOTS_SPEED_BONUS } from "../../shared/items";
import { PLAYER_SPEED } from "../../shared/rules";
import { effectiveMovementSpeedForProgress } from "./player-speed";
import { bonusMoveSpeedFactor } from "./weapon-mastery";
import { readPlayerProgress } from "./wide-stats";

/** The slack a movement packet gets on top of speed × time (presence-runtime's MOVEMENT_POSITION_PACKET_TOLERANCE; a test keeps them equal). */
export const DOOR_POSITION_TOLERANCE = 96;

/**
 * Where a door reducer sends a player (shared/door-reach.ts has why): its rule at the server's extrapolated
 * position, or else anywhere the player could have walked since their last movement packet, at the fastest
 * speed the server would accept from them in one.
 */
export function doorDestinationFor<T>(
  ctx: any,
  moving: { x: number; y: number; speed?: number; identity: any; mapId: string },
  destinationAt: (x: number, y: number) => T | null,
  sides: readonly { x: number; y: number }[],
): T | null {
  const exact = destinationAt(moving.x, moving.y);
  if (exact) return exact;
  const motion = ctx.db.playerMotion.identity.find(moving.identity);
  if (!motion || motion.mapId !== moving.mapId || ![motion.x, motion.y].every(Number.isFinite)) return null;
  const elapsed = Math.max(0, Number(ctx.timestamp.microsSinceUnixEpoch - motion.lastInputAt.microsSinceUnixEpoch) / 1_000_000);
  const speed = walkSpeedFor(ctx, moving, readPlayerProgress(ctx, moving.identity));
  return doorDestinationWithin(destinationAt, motion, speed * elapsed + DOOR_POSITION_TOLERANCE, sides);
}

/** The fastest walk the server would accept from this player in one movement packet. */
export function walkSpeedFor(ctx: any, moving: { speed?: number; identity: any }, progress: any) {
  return Math.max(PLAYER_SPEED, Number.isFinite(moving.speed) ? moving.speed! : 0,
    progress ? (effectiveMovementSpeedForProgress(ctx, progress) + BLACK_BOOTS_SPEED_BONUS) * bonusMoveSpeedFactor(ctx, moving.identity, progress) : 0);
}

/**
 * Whether a player is within `range` of a station (the Loadout Upgrades bench): at the server's position, or
 * anywhere they could have walked since their last movement packet, as a door is judged.
 */
export function withinStationReach(ctx: any, player: { x: number; y: number; speed?: number; identity: any; mapId: string },
  station: { x: number; y: number }, range: number) {
  return doorDestinationFor(ctx, player, (x, y) => Math.hypot(x - station.x, y - station.y) <= range ? true : null, [station]) === true;
}

/**
 * Where a player asking to stand at (x, y) may stop: there, if they could have walked to it since their last
 * movement packet (the same allowance a movement packet and a station get), else the nearest point they could.
 */
export function reachableStopFor(ctx: any, player: { x: number; y: number; speed?: number; identity: any; mapId: string },
  x: number, y: number) {
  const motion = ctx.db.playerMotion.identity.find(player.identity);
  const known = motion && motion.mapId === player.mapId && [motion.x, motion.y].every(Number.isFinite);
  // With no motion row on this map the player has not walked, so only the packet slack applies.
  const from = known ? motion : player;
  const elapsed = known ? Math.max(0, Number(ctx.timestamp.microsSinceUnixEpoch - motion.lastInputAt.microsSinceUnixEpoch) / 1_000_000) : 0;
  const walked = walkSpeedFor(ctx, player, readPlayerProgress(ctx, player.identity)) * elapsed;
  const reach = (Number.isFinite(walked) ? walked : 0) + DOOR_POSITION_TOLERANCE;
  const distance = Math.hypot(x - from.x, y - from.y);
  if (distance <= reach) return { x, y };
  const k = reach / distance;
  return { x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k };
}
