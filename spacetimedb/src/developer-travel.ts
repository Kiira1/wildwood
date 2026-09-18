import { Identity, TimeDuration } from "spacetimedb";
import { SenderError } from "spacetimedb/server";
import { HOME_EXTERIOR_MAP_ID } from "../../shared/home";
import { combatMap } from "../../shared/enemy-defeats";
import { PLAYER_RADIUS, WORLD_WIDTH, WORLD_HEIGHT } from "../../shared/rules";
import { isMapShard, rootShardingEnabled } from "./map-sharding";

// Called only after the authenticated developer check; never exposed as a public location directory.
export function findDeveloperTravelTarget(ctx: any, query: string) {
  const name = query.trim().toLowerCase();
  if (!name || name.length > 80) throw new SenderError("Enter a player username.");
  if (/^(?:0x)?[a-f0-9]{64}$/.test(name)) return readDeveloperTravelTarget(ctx, Identity.fromString(name));
  const matches = [...ctx.db.playerProfile.iter()].filter((row: any) => row.displayName.toLowerCase() === name);
  if (matches.length !== 1) throw new SenderError(matches.length ? "Multiple players have that name. Use their account ID." : "Player not found.");
  return readDeveloperTravelTarget(ctx, matches[0].identity);
}

export function readDeveloperTravelTarget(ctx: any, identity: Identity, expectedMap?: string) {
  if (isMapShard(ctx)) throw new SenderError("Use the world connection.");
  if (identity.equals(ctx.sender)) throw new SenderError("You are already at your own player.");
  const player = ctx.db.player.identity.find(identity);
  const controller = ctx.db.playerController.identity.find(identity);
  const session = controller && ctx.db.playerSession.connectionId.find(controller.connectionId);
  if (!player || !session?.enteredWorld || !session.identity.equals(identity)) throw new SenderError("Player is offline.");
  if (player.mapId === HOME_EXTERIOR_MAP_ID || !combatMap(player.mapId)) throw new SenderError("Player is in a private map.");
  if (expectedMap && expectedMap !== player.mapId) throw new SenderError("Player changed maps. Try again.");
  const member = rootShardingEnabled(ctx) ? ctx.db.mapShardMember.identity.find(identity) : null;
  const shard = member && ctx.db.mapShard.id.find(member.shardId);
  if (rootShardingEnabled(ctx) && (!member?.ready || member.mapId !== player.mapId || shard?.state !== "ready"))
    throw new SenderError("Player is changing maps. Try again.");
  const motion = ctx.db.playerMotion.identity.find(identity);
  const position = motion?.mapId === player.mapId ? motion : player;
  return { identity, displayName: ctx.db.playerProfile.identity.find(identity)?.displayName ?? "Player", mapId: player.mapId,
    x: position.x, y: position.y, facing: position.facing,
    shardId: member?.shardId as bigint | undefined, generation: member?.generation as bigint | undefined,
    databaseName: shard?.databaseName as string | undefined };
}

/** One on-demand read from the assigned shard, no new movement subscription or polling. */
export function readShardTravelPosition(ctx: any, target: ReturnType<typeof readDeveloperTravelTarget>) {
  if (!target.databaseName) return null;
  const config = ctx.withTx((tx: any) => tx.db.shardCoordinatorConnection.id.find(0));
  if (!config) throw new SenderError("Map connection unavailable. Try again.");
  const response = ctx.http.fetch(`${config.host}/v1/database/${encodeURIComponent(target.databaseName)}/sql`, {
    method: "POST", body: `SELECT x, y, map_id FROM player_motion WHERE identity = 0x${target.identity.toHexString().replace(/^0x/, "")}`,
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "text/plain" }, timeout: TimeDuration.fromMillis(5_000),
  });
  if (response.status !== 200) throw new SenderError("Could not locate player on their map. Try again.");
  const rows = JSON.parse(response.text())?.[0]?.rows;
  const row = rows?.[0];
  if (!row || row[2] !== target.mapId || !Number.isFinite(row[0]) || !Number.isFinite(row[1]))
    throw new SenderError("Player's position is unavailable. Try again.");
  return { x: Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, row[0])),
    y: Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, row[1])) };
}
