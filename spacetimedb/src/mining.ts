import { SenderError, table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import { cardStatFactors } from "../../shared/card-effects";
import { wornCardTotalsFor } from "./worn-cards";
import type spacetimedbType from "./index";
import {
  MINING_NODE_KINDS, MINING_RATE_SLACK, MINING_SERVER_REACH, MINING_VEINS, miningBreakSeconds, miningGain, miningNode, miningVeinMap,
  miningVeinOpen, miningYield, normalizeMining, type MiningNode,
} from "../../shared/mining";
import { REFINE_ORES, type OreId } from "../../shared/refine";
import { TOWN_FEET_OFFSET, TOWN_SMITH_POSITION, TOWN_SMITH_SERVER_REACH } from "../../shared/town";
import { isTownMap } from "./town";
import { withinStationReach } from "./door-reach";
import { readPlayerProgress } from "./wide-stats";
import { addOres, oreCountsFor } from "./item-refine";
import { extraCopiesOf } from "./equipment-copies";
import { bagCapacityFor } from "./bag-capacity";
import { bagFullForOres, rockOreKinds, roomForOres } from "../../shared/ore-bag";

/**
 * Mining (shared/mining.ts): a player's Mining stat, the pickaxe the Smith gives them, and the rocks they broke
 * that have yet to grow back. Each player has their own rocks, so a rock is bare for whoever broke it and no one
 * else. Private tables, read through the caller's own views.
 *
 * No player_mining row means no pickaxe yet, and Mining 0. `rocksBroken` counts up with every break, so the client
 * can tell a new break from the row it found on connect; `lastNodeId` and `lastStarshard` say what that break gave.
 */
export const playerMining = table({ name: "player_mining", public: false }, {
  identity: t.identity().primaryKey(),
  mining: t.u32(),
  rocksBroken: t.u32(),
  pickaxeAt: t.timestamp(),
  lastBreakAt: t.timestamp(),
  lastNodeId: t.u32(),
  lastStarshard: t.bool(),
});

/** A rock a player broke, until it grows back for them. Rows that have grown back are cleared as they mine. */
export const playerMinedNode = table({ name: "player_mined_node", public: false }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  nodeId: t.u32(),
  brokenAt: t.timestamp(),
});

type Ctx = any;
const U32_MAX = 4_294_967_295;

export const minedNodeKey = (identity: { toHexString(): string }, nodeId: number) => `${identity.toHexString()}:${nodeId}`;

const microsSince = (ctx: Ctx, at: { microsSinceUnixEpoch: bigint }) => Number(ctx.timestamp.microsSinceUnixEpoch - at.microsSinceUnixEpoch);
const grownBack = (ctx: Ctx, row: { nodeId: number; brokenAt: { microsSinceUnixEpoch: bigint } }) => {
  const node = miningNode(row.nodeId);
  return !node || microsSince(ctx, row.brokenAt) >= MINING_NODE_KINDS[node.kind].respawnSeconds * 1_000_000;
};

/** The player's Mining stat; 0 before the Smith's pickaxe. */
export function miningFor(ctx: Ctx, identity: Identity) {
  return normalizeMining(ctx.db.playerMining.identity.find(identity)?.mining);
}

/** Whether a rock is bare for this player: broken by them less than its regrowth ago. */
export function nodeBareFor(ctx: Ctx, identity: Identity, node: MiningNode) {
  const row = ctx.db.playerMinedNode.key.find(minedNodeKey(identity, node.id));
  return Boolean(row && !grownBack(ctx, row));
}

/** Clears the player's rows for rocks that have grown back: only the bare ones are kept. */
function pruneMinedNodes(ctx: Ctx, identity: Identity) {
  for (const row of [...ctx.db.playerMinedNode.identity.filter(identity)]) {
    if (grownBack(ctx, row)) ctx.db.playerMinedNode.key.delete(row.key);
  }
}

function rowsOf(handle: any, identity: Identity): any[] {
  return [...handle.identity.filter(identity)];
}

/** Reset Save and a deleted account take Mining, the pickaxe and the bare rocks. Prestige keeps them all. */
export function removeMiningData(ctx: Ctx, identity: Identity) {
  if (ctx.db.playerMining.identity.find(identity)) ctx.db.playerMining.identity.delete(identity);
  for (const row of rowsOf(ctx.db.playerMinedNode, identity)) ctx.db.playerMinedNode.key.delete(row.key);
}

/** A guest's save replaces the account's on link (mergeRefineData), Mining and pickaxe with it. */
export function mergeMiningData(ctx: Ctx, guest: Identity, account: Identity) {
  removeMiningData(ctx, account);
  const mining = ctx.db.playerMining.identity.find(guest);
  if (mining) {
    ctx.db.playerMining.identity.delete(guest);
    ctx.db.playerMining.insert({ ...mining, identity: account });
  }
  for (const row of rowsOf(ctx.db.playerMinedNode, guest)) {
    ctx.db.playerMinedNode.key.delete(row.key);
    ctx.db.playerMinedNode.insert({ ...row, key: minedNodeKey(account, row.nodeId), identity: account });
  }
}

/** The Smith hands over the pickaxe: where a player stands (not their feet) beside him, as for refining. */
const SMITH_STAND = { x: TOWN_SMITH_POSITION.x, y: TOWN_SMITH_POSITION.y - TOWN_FEET_OFFSET };

export type MiningDeps = {
  requireControllingPlayer: (ctx: Ctx) => any;
  activeDuelFor: (ctx: Ctx, identity: Identity) => unknown;
  /** The bag's items from the saved progress, for its space: each kind of ore takes a slot (shared/ore-bag.ts). */
  inventoryForProgress?: (progress: any) => string[];
};

const equippedFields = (progress: any): string[] =>
  [progress.equippedHead, progress.equippedChest, progress.equippedFeet, progress.equippedRightHand, progress.equippedLeftHand];

/** The Smith's free pickaxe (Morkyl's "it's a quest, so it's free"): what every rock asks for. */
export function claimPickaxeFor(ctx: Ctx, deps: MiningDeps) {
  const player = deps.requireControllingPlayer(ctx);
  if (!isTownMap(player.mapId) || !withinStationReach(ctx, player, SMITH_STAND, TOWN_SMITH_SERVER_REACH)) {
    throw new SenderError("Talk to the Smith first.");
  }
  if (ctx.db.playerMining.identity.find(ctx.sender)) throw new SenderError("You already have a pickaxe.");
  ctx.db.playerMining.insert({ identity: ctx.sender, mining: 0, rocksBroken: 0, pickaxeAt: ctx.timestamp, lastBreakAt: ctx.timestamp,
    lastNodeId: 0, lastStarshard: false });
}

/**
 * One broken rock. The client times the swing; the server takes the break from where it last heard the player
 * stood (with the walk since, as a door is judged), no sooner than the rock allows after their last break, and
 * only from a rock that is not still bare for them. The ore is the server's roll.
 */
export function mineNodeFor(ctx: Ctx, args: { nodeId: number }, deps: MiningDeps) {
  const player = deps.requireControllingPlayer(ctx);
  const node = miningNode(args.nodeId);
  if (!node) throw new SenderError("There is no rock there.");
  const mining = ctx.db.playerMining.identity.find(ctx.sender);
  if (!mining) throw new SenderError("You need a pickaxe. The Smith in Town has one.");
  if (!isTownMap(player.mapId) || !withinStationReach(ctx, player, { x: node.x, y: node.y - TOWN_FEET_OFFSET }, MINING_SERVER_REACH)) {
    throw new SenderError("Walk up to the rock first.");
  }
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const vein = MINING_VEINS[node.vein];
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!miningVeinOpen(vein, progress)) {
    throw new SenderError(`Reach ${miningVeinMap(vein)} to mine ${REFINE_ORES[vein.ore].name}.`);
  }
  // A kind of ore not held yet needs a free bag slot, for everything the rock could give, before it is broken.
  const { needed, room } = roomForOres({
    owned: progress && deps.inventoryForProgress ? deps.inventoryForProgress(progress) : [], equipped: progress ? equippedFields(progress) : [],
    extraCopies: extraCopiesOf(ctx, ctx.sender).length, ores: oreCountsFor(ctx, ctx.sender),
    capacity: bagCapacityFor(ctx, ctx.sender),
  }, rockOreKinds(node));
  if (!room) throw new SenderError(bagFullForOres(needed));
  pruneMinedNodes(ctx, ctx.sender);
  if (nodeBareFor(ctx, ctx.sender, node)) throw new SenderError("That rock is still growing back.");
  // Mining Speed, Ore Find and Starshard cards in the worn gear.
  const cards = cardStatFactors(wornCardTotalsFor(ctx, ctx.sender, progress));
  if (microsSince(ctx, mining.lastBreakAt) < miningBreakSeconds(node, mining.mining, cards.miningSpeed) * MINING_RATE_SLACK * 1_000_000) {
    throw new SenderError("Still mining.");
  }
  const ores = miningYield(node, ctx.random(), cards, cards.oreFind > 0 ? ctx.random() : 1);
  for (const [oreId, count] of Object.entries(ores)) addOres(ctx, ctx.sender, oreId as OreId, count ?? 0);
  ctx.db.playerMining.identity.update({
    ...mining,
    mining: Math.min(U32_MAX, normalizeMining(mining.mining) + miningGain(node)),
    rocksBroken: (mining.rocksBroken + 1) % (U32_MAX + 1),
    lastBreakAt: ctx.timestamp,
    lastNodeId: node.id,
    lastStarshard: Boolean(ores.starshard),
  });
  const key = minedNodeKey(ctx.sender, node.id), bare = ctx.db.playerMinedNode.key.find(key);
  if (bare) ctx.db.playerMinedNode.key.update({ ...bare, brokenAt: ctx.timestamp });
  else ctx.db.playerMinedNode.insert({ key, identity: ctx.sender, nodeId: node.id, brokenAt: ctx.timestamp });
}

/** The pickaxe, a break, and the caller's own Mining and bare rocks. */
export function registerMining(spacetimedb: typeof spacetimedbType, deps: MiningDeps) {
  const claimPickaxe = spacetimedb.reducer({}, (ctx: any) => claimPickaxeFor(ctx, deps));
  const mineNode = spacetimedb.reducer({ nodeId: t.u32() }, (ctx: any, args: { nodeId: number }) => mineNodeFor(ctx, args, deps));
  const myMining = spacetimedb.view({ name: "my_mining", public: true }, t.array(playerMining.rowType), (ctx: any) => {
    const row = ctx.db.playerMining.identity.find(ctx.sender);
    return row ? [row] : [];
  });
  const myMinedNodes = spacetimedb.view({ name: "my_mined_nodes", public: true }, t.array(playerMinedNode.rowType),
    (ctx: any) => [...ctx.db.playerMinedNode.identity.filter(ctx.sender)]);
  return { claimPickaxe, mineNode, myMining, myMinedNodes };
}
