import { SenderError, table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import {
  WOOD_STANDS, WOODCUTTING_RATE_SLACK, WOODCUTTING_RESPAWN_SECONDS, WOODCUTTING_SERVER_REACH, normalizeWoodcutting, woodcuttingChopSeconds,
  woodcuttingGain, woodcuttingYield, woodStandHint, woodStandOpen, woodTree,
} from "../../shared/woodcutting";
import type { OreId } from "../../shared/refine";
import { TOWN_FEET_OFFSET, TOWN_SMITH_POSITION, TOWN_SMITH_SERVER_REACH } from "../../shared/town";
import { isTownMap } from "./town";
import { withinStationReach } from "./door-reach";
import { readPlayerProgress } from "./wide-stats";
import { addOres, oreCountsFor } from "./item-refine";
import { extraCopiesOf } from "./equipment-copies";
import { bagCapacityFor } from "./bag-capacity";
import { bagFullForOres, roomForOres } from "../../shared/ore-bag";
import type { MiningDeps } from "./mining";
import { toolBonusYield } from "../../shared/tools";
import { toolLevelFor } from "./tools";

/**
 * Woodcutting (shared/woodcutting.ts), as mining is (mining.ts): a player's Woodcutting stat, the hatchet the Smith
 * gives them, and the trees they felled that have yet to grow back, for them alone. Private tables, read through
 * the caller's own views; the stat is copied to a public table for profiles.
 *
 * No player_woodcutting row means no hatchet yet, and Woodcutting 0. `treesChopped` counts up with every fall, so
 * the client can tell a new one from the row it found on connect; `lastTreeId` says which tree that was.
 */
export const playerWoodcutting = table({ name: "player_woodcutting", public: false }, {
  identity: t.identity().primaryKey(),
  woodcutting: t.u32(),
  treesChopped: t.u32(),
  hatchetAt: t.timestamp(),
  lastChopAt: t.timestamp(),
  lastTreeId: t.u32(),
});

/** A tree a player felled, until it grows back for them. Rows that have grown back are cleared as they chop. */
export const playerChoppedTree = table({ name: "player_chopped_tree", public: false }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  treeId: t.u32(),
  choppedAt: t.timestamp(),
});

/** Each player's Woodcutting stat, public, for profiles; writeWoodcuttingLevel keeps it in step. */
export const playerWoodcuttingLevel = table({ name: "player_woodcutting_level", public: true }, {
  identity: t.identity().primaryKey(),
  woodcutting: t.u32(),
});

type Ctx = any;
const U32_MAX = 4_294_967_295;

/** Copies a player's Woodcutting stat to player_woodcutting_level, or removes it with no hatchet. */
export function writeWoodcuttingLevel(ctx: Ctx, identity: Identity) {
  const row = ctx.db.playerWoodcutting.identity.find(identity), level = ctx.db.playerWoodcuttingLevel.identity.find(identity);
  if (!row) { if (level) ctx.db.playerWoodcuttingLevel.identity.delete(identity); return; }
  const woodcutting = normalizeWoodcutting(row.woodcutting);
  if (!level) ctx.db.playerWoodcuttingLevel.insert({ identity, woodcutting });
  else if (level.woodcutting !== woodcutting) ctx.db.playerWoodcuttingLevel.identity.update({ identity, woodcutting });
}

export const choppedTreeKey = (identity: { toHexString(): string }, treeId: number) => `${identity.toHexString()}:${treeId}`;

const microsSince = (ctx: Ctx, at: { microsSinceUnixEpoch: bigint }) => Number(ctx.timestamp.microsSinceUnixEpoch - at.microsSinceUnixEpoch);
const grownBack = (ctx: Ctx, row: { choppedAt: { microsSinceUnixEpoch: bigint } }) => microsSince(ctx, row.choppedAt) >= WOODCUTTING_RESPAWN_SECONDS * 1_000_000;

/** The player's Woodcutting stat; 0 before the Smith's hatchet. */
export function woodcuttingFor(ctx: Ctx, identity: Identity) {
  return normalizeWoodcutting(ctx.db.playerWoodcutting.identity.find(identity)?.woodcutting);
}

/** Whether a tree is a stump for this player: felled by them less than its regrowth ago. */
export function treeFelledFor(ctx: Ctx, identity: Identity, treeId: number) {
  const row = ctx.db.playerChoppedTree.key.find(choppedTreeKey(identity, treeId));
  return Boolean(row && !grownBack(ctx, row));
}

/** Clears the player's rows for trees that have grown back: only the stumps are kept. */
function pruneChoppedTrees(ctx: Ctx, identity: Identity) {
  for (const row of [...ctx.db.playerChoppedTree.identity.filter(identity)]) {
    if (grownBack(ctx, row)) ctx.db.playerChoppedTree.key.delete(row.key);
  }
}

function rowsOf(handle: any, identity: Identity): any[] {
  return [...handle.identity.filter(identity)];
}

/** Reset Save and a deleted account take Woodcutting, the hatchet and the stumps. Prestige keeps them all. */
export function removeWoodcuttingData(ctx: Ctx, identity: Identity) {
  if (ctx.db.playerWoodcutting.identity.find(identity)) ctx.db.playerWoodcutting.identity.delete(identity);
  writeWoodcuttingLevel(ctx, identity);
  for (const row of rowsOf(ctx.db.playerChoppedTree, identity)) ctx.db.playerChoppedTree.key.delete(row.key);
}

/** A guest's save replaces the account's on link (mergeMiningData), Woodcutting and hatchet with it. */
export function mergeWoodcuttingData(ctx: Ctx, guest: Identity, account: Identity) {
  removeWoodcuttingData(ctx, account);
  const woodcutting = ctx.db.playerWoodcutting.identity.find(guest);
  if (woodcutting) {
    ctx.db.playerWoodcutting.identity.delete(guest);
    ctx.db.playerWoodcutting.insert({ ...woodcutting, identity: account });
    writeWoodcuttingLevel(ctx, guest);
    writeWoodcuttingLevel(ctx, account);
  }
  for (const row of rowsOf(ctx.db.playerChoppedTree, guest)) {
    ctx.db.playerChoppedTree.key.delete(row.key);
    ctx.db.playerChoppedTree.insert({ ...row, key: choppedTreeKey(account, row.treeId), identity: account });
  }
}

/** The Smith hands over the hatchet: where a player stands (not their feet) beside him, as for the pickaxe. */
const SMITH_STAND = { x: TOWN_SMITH_POSITION.x, y: TOWN_SMITH_POSITION.y - TOWN_FEET_OFFSET };

const equippedFields = (progress: any): string[] =>
  [progress.equippedHead, progress.equippedChest, progress.equippedFeet, progress.equippedRightHand, progress.equippedLeftHand];

/** The Smith's free hatchet, handed out as his pickaxe is: what every tree asks for. */
export function claimHatchetFor(ctx: Ctx, deps: MiningDeps) {
  const player = deps.requireControllingPlayer(ctx);
  if (!isTownMap(player.mapId) || !withinStationReach(ctx, player, SMITH_STAND, TOWN_SMITH_SERVER_REACH)) {
    throw new SenderError("Talk to the Smith first.");
  }
  if (ctx.db.playerWoodcutting.identity.find(ctx.sender)) throw new SenderError("You already have a hatchet.");
  ctx.db.playerWoodcutting.insert({ identity: ctx.sender, woodcutting: 0, treesChopped: 0, hatchetAt: ctx.timestamp, lastChopAt: ctx.timestamp, lastTreeId: 0 });
  writeWoodcuttingLevel(ctx, ctx.sender);
}

/**
 * One felled tree, judged as a broken rock is (mineNodeFor): from where the server last heard the player stood
 * (with the walk since), no sooner than the tree allows after their last fall, and only from a tree that is not
 * still a stump for them.
 */
export function chopTreeFor(ctx: Ctx, args: { treeId: number }, deps: MiningDeps) {
  const player = deps.requireControllingPlayer(ctx);
  const tree = woodTree(args.treeId);
  if (!tree) throw new SenderError("There is no tree there.");
  const woodcutting = ctx.db.playerWoodcutting.identity.find(ctx.sender);
  if (!woodcutting) throw new SenderError("You need a hatchet. The Smith in Town has one.");
  if (!isTownMap(player.mapId) || !withinStationReach(ctx, player, { x: tree.x, y: tree.y - TOWN_FEET_OFFSET }, WOODCUTTING_SERVER_REACH)) {
    throw new SenderError("Walk up to the tree first.");
  }
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const stand = WOOD_STANDS[tree.stand];
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!woodStandOpen(stand, progress)) throw new SenderError(woodStandHint(stand));
  // A kind of log not held yet needs a free bag slot before the tree falls.
  const { needed, room } = roomForOres({
    owned: progress && deps.inventoryForProgress ? deps.inventoryForProgress(progress) : [], equipped: progress ? equippedFields(progress) : [],
    extraCopies: extraCopiesOf(ctx, ctx.sender).length, ores: oreCountsFor(ctx, ctx.sender),
    capacity: bagCapacityFor(ctx, ctx.sender),
  }, [tree.log]);
  if (!room) throw new SenderError(bagFullForOres(needed));
  pruneChoppedTrees(ctx, ctx.sender);
  if (treeFelledFor(ctx, ctx.sender, tree.id)) throw new SenderError("That tree is still growing back.");
  const hatchet = toolLevelFor(ctx, ctx.sender, "hatchet");
  if (microsSince(ctx, woodcutting.lastChopAt) < woodcuttingChopSeconds(tree, woodcutting.woodcutting, hatchet) * WOODCUTTING_RATE_SLACK * 1_000_000) {
    throw new SenderError("Still chopping.");
  }
  const logs = woodcuttingYield(tree, hatchet > 0 ? toolBonusYield(hatchet, ctx.random()) : 0);
  for (const [logId, count] of Object.entries(logs)) addOres(ctx, ctx.sender, logId as OreId, count ?? 0);
  ctx.db.playerWoodcutting.identity.update({
    ...woodcutting,
    woodcutting: Math.min(U32_MAX, normalizeWoodcutting(woodcutting.woodcutting) + woodcuttingGain(tree)),
    treesChopped: (woodcutting.treesChopped + 1) % (U32_MAX + 1),
    lastChopAt: ctx.timestamp,
    lastTreeId: tree.id,
  });
  writeWoodcuttingLevel(ctx, ctx.sender);
  const key = choppedTreeKey(ctx.sender, tree.id), stump = ctx.db.playerChoppedTree.key.find(key);
  if (stump) ctx.db.playerChoppedTree.key.update({ ...stump, choppedAt: ctx.timestamp });
  else ctx.db.playerChoppedTree.insert({ key, identity: ctx.sender, treeId: tree.id, choppedAt: ctx.timestamp });
}

/** The hatchet, a fall, and the caller's own Woodcutting and stumps. */
export function registerWoodcutting(spacetimedb: typeof spacetimedbType, deps: MiningDeps) {
  const claimHatchet = spacetimedb.reducer({}, (ctx: any) => claimHatchetFor(ctx, deps));
  const chopTree = spacetimedb.reducer({ treeId: t.u32() }, (ctx: any, args: { treeId: number }) => chopTreeFor(ctx, args, deps));
  const myWoodcutting = spacetimedb.view({ name: "my_woodcutting", public: true }, t.array(playerWoodcutting.rowType), (ctx: any) => {
    const row = ctx.db.playerWoodcutting.identity.find(ctx.sender);
    return row ? [row] : [];
  });
  const myChoppedTrees = spacetimedb.view({ name: "my_chopped_trees", public: true }, t.array(playerChoppedTree.rowType),
    (ctx: any) => [...ctx.db.playerChoppedTree.identity.filter(ctx.sender)]);
  return { claimHatchet, chopTree, myWoodcutting, myChoppedTrees };
}
