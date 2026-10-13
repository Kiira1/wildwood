import { SenderError, table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import { REFINE_MAX, REFINE_ORES, isRefinableItem, normalizeRefineLevel, refineCost, rollRefine, type OreId } from "../../shared/refine";
import { canonicalItemId } from "../../shared/items";
import { isTownMap, TOWN_BENCH_POSITION } from "./town";
import { withinStationReach } from "./door-reach";
import { readPlayerProgress } from "./wide-stats";

/**
 * Refining (shared/refine.ts): each item's own level, +0 to +20, and the ores a try costs.
 *
 * A refine belongs to one copy of an item. The first copy, the item id in inventoryJson and the one an
 * equipment slot holds, has its level in player_item_refine, keyed like player_bow_skill; a kept extra copy
 * has its own in player_copy_refine, keyed by the copy's id. When a copy becomes the first (choosing it,
 * or destroying the first while it is kept), its level moves with it, as its bow roll does
 * (equipment-copies.ts). +0 has no row.
 *
 * New tables rather than columns: a column on a table every session reads would strand every open tab on
 * publish. player_item_refine is public, so a profile can show another player's +7; the rest are private and
 * read through the caller's own views.
 */
export const playerItemRefine = table({ name: "player_item_refine", public: true }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  itemId: t.string(),
  level: t.u8(),
});

export const playerCopyRefine = table({ name: "player_copy_refine", public: false }, {
  copyId: t.u64().primaryKey(),
  identity: t.identity().index("btree"),
  itemId: t.string(),
  level: t.u8(),
});

/** A player's ores, one row per kind held. No row is none. */
export const playerOre = table({ name: "player_ore", public: false }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  oreId: t.string(),
  count: t.u32(),
});

/**
 * The player's last refine try, so the window can show it worked or failed. `attempt` counts up with every try,
 * so two tries that end the same way still read as two.
 */
export const playerRefineResult = table({ name: "player_refine_result", public: false }, {
  identity: t.identity().primaryKey(),
  itemId: t.string(),
  copyId: t.u64(),
  fromLevel: t.u8(),
  toLevel: t.u8(),
  succeeded: t.bool(),
  attempt: t.u32(),
  triedAt: t.timestamp(),
});

type Ctx = any;

export const itemRefineKey = (identity: { toHexString(): string }, itemId: string) => `${identity.toHexString()}:${itemId}`;
export const oreKey = (identity: { toHexString(): string }, oreId: string) => `${identity.toHexString()}:${oreId}`;
export const isOreId = (value: unknown): value is OreId => typeof value === "string" && Object.prototype.hasOwnProperty.call(REFINE_ORES, value);

/** The refine level of one copy: `copyId` 0 is the first copy. */
export function refineLevelFor(ctx: Ctx, identity: Identity, itemId: string, copyId = 0n) {
  const row = copyId === 0n ? ctx.db.playerItemRefine.key.find(itemRefineKey(identity, itemId)) : ctx.db.playerCopyRefine.copyId.find(copyId);
  return row ? normalizeRefineLevel(row.level) : 0;
}

/** Writes one copy's level; +0 removes its row. */
export function setRefineLevel(ctx: Ctx, identity: Identity, itemId: string, copyId: bigint, level: number) {
  const next = normalizeRefineLevel(level);
  if (copyId === 0n) {
    const key = itemRefineKey(identity, itemId);
    const current = ctx.db.playerItemRefine.key.find(key);
    if (!next) { if (current) ctx.db.playerItemRefine.key.delete(key); return; }
    if (current) { if (current.level !== next) ctx.db.playerItemRefine.key.update({ ...current, level: next }); }
    else ctx.db.playerItemRefine.insert({ key, identity, itemId, level: next });
    return;
  }
  const current = ctx.db.playerCopyRefine.copyId.find(copyId);
  if (!next) { if (current) ctx.db.playerCopyRefine.copyId.delete(copyId); return; }
  if (current) { if (current.level !== next) ctx.db.playerCopyRefine.copyId.update({ ...current, level: next }); }
  else ctx.db.playerCopyRefine.insert({ copyId, identity, itemId, level: next });
}

/** Choosing a kept copy makes it the first: the two copies trade levels, as they trade bow rolls. */
export function swapFirstCopyRefine(ctx: Ctx, identity: Identity, itemId: string, copyId: bigint) {
  const first = refineLevelFor(ctx, identity, itemId), copy = refineLevelFor(ctx, identity, itemId, copyId);
  setRefineLevel(ctx, identity, itemId, 0n, copy);
  setRefineLevel(ctx, identity, itemId, copyId, first);
}

/** The first copy is gone and a kept copy takes its place: the kept copy's level comes with it. */
export function promoteCopyRefine(ctx: Ctx, identity: Identity, itemId: string, copyId: bigint) {
  setRefineLevel(ctx, identity, itemId, 0n, refineLevelFor(ctx, identity, itemId, copyId));
  setRefineLevel(ctx, identity, itemId, copyId, 0);
}

export function oreCount(ctx: Ctx, identity: Identity, oreId: string) {
  return ctx.db.playerOre.key.find(oreKey(identity, oreId))?.count ?? 0;
}

const ORE_COUNT_MAX = 4_294_967_295;
export function addOres(ctx: Ctx, identity: Identity, oreId: OreId, count: number) {
  const amount = Math.floor(count);
  if (!(amount > 0)) return;
  const key = oreKey(identity, oreId), current = ctx.db.playerOre.key.find(key);
  if (current) ctx.db.playerOre.key.update({ ...current, count: Math.min(ORE_COUNT_MAX, current.count + amount) });
  else ctx.db.playerOre.insert({ key, identity, oreId, count: Math.min(ORE_COUNT_MAX, amount) });
}

/** Whether the player holds every ore in `cost`. */
export function hasOres(ctx: Ctx, identity: Identity, cost: Partial<Record<OreId, number>>) {
  return Object.entries(cost).every(([oreId, count]) => oreCount(ctx, identity, oreId) >= (count ?? 0));
}

/** Takes every ore in `cost`, or none when one is short. Returns whether it did. */
export function takeOres(ctx: Ctx, identity: Identity, cost: Partial<Record<OreId, number>>) {
  if (!hasOres(ctx, identity, cost)) return false;
  for (const [oreId, count] of Object.entries(cost)) {
    if (!count) continue;
    const key = oreKey(identity, oreId), current = ctx.db.playerOre.key.find(key)!;
    if (current.count === count) ctx.db.playerOre.key.delete(key);
    else ctx.db.playerOre.key.update({ ...current, count: current.count - count });
  }
  return true;
}

function rowsOf(handle: any, identity: Identity): any[] {
  return [...handle.identity.filter(identity)];
}

/** Reset Save and a deleted account take the bag; its refines and the ores go with it. Prestige keeps them. */
export function removeRefineData(ctx: Ctx, identity: Identity) {
  for (const row of rowsOf(ctx.db.playerItemRefine, identity)) ctx.db.playerItemRefine.key.delete(row.key);
  for (const row of rowsOf(ctx.db.playerCopyRefine, identity)) ctx.db.playerCopyRefine.copyId.delete(row.copyId);
  for (const row of rowsOf(ctx.db.playerOre, identity)) ctx.db.playerOre.key.delete(row.key);
  if (ctx.db.playerRefineResult.identity.find(identity)) ctx.db.playerRefineResult.identity.delete(identity);
}

/**
 * A guest's save replaces the account's on link, bag included (mergeEquipmentCopies), so the guest's refines and
 * ores replace the account's: the account's go, and the guest's move over as they were.
 */
export function mergeRefineData(ctx: Ctx, guest: Identity, account: Identity) {
  removeRefineData(ctx, account);
  for (const row of rowsOf(ctx.db.playerItemRefine, guest)) {
    ctx.db.playerItemRefine.key.delete(row.key);
    ctx.db.playerItemRefine.insert({ ...row, key: itemRefineKey(account, row.itemId), identity: account });
  }
  for (const row of rowsOf(ctx.db.playerCopyRefine, guest)) ctx.db.playerCopyRefine.copyId.update({ ...row, identity: account });
  for (const row of rowsOf(ctx.db.playerOre, guest)) {
    ctx.db.playerOre.key.delete(row.key);
    ctx.db.playerOre.insert({ ...row, key: oreKey(account, row.oreId), identity: account });
  }
  const result = ctx.db.playerRefineResult.identity.find(guest);
  if (result) ctx.db.playerRefineResult.identity.delete(guest);
}

/** Refining happens at the Town bench, within the reach its slot upgrades use. */
export const REFINE_BENCH_USE_RANGE = 75;

export type ItemRefineDeps = {
  requireControllingPlayer: (ctx: Ctx) => any;
  activeDuelFor: (ctx: Ctx, identity: Identity) => unknown;
  inventoryForProgress: (progress: any) => string[];
  writeProgressAndPresentation: (ctx: Ctx, progress: any) => void;
};

const equippedFields = (progress: any): string[] =>
  [progress.equippedHead, progress.equippedChest, progress.equippedFeet, progress.equippedRightHand, progress.equippedLeftHand];

const oreList = (cost: Partial<Record<OreId, number>>) =>
  Object.entries(cost).map(([oreId, count]) => `${count} ${REFINE_ORES[oreId as OreId].name}`).join(" and ");

/**
 * One refine try on one copy of an item: `copyId` 0 is the first copy, the one a slot holds. `expectedLevel` is
 * the level the player saw, so a double tap or a stale window cannot spend a second ore on a try they did not
 * mean. The ore goes whether the try works or not; the roll is the server's (shared/refine.ts rollRefine).
 */
export function refineItemFor(ctx: Ctx, args: { itemId: string; copyId: bigint; expectedLevel: number }, deps: ItemRefineDeps) {
  const player = deps.requireControllingPlayer(ctx);
  if (!isTownMap(player.mapId) || !withinStationReach(ctx, player, TOWN_BENCH_POSITION, REFINE_BENCH_USE_RANGE)) {
    throw new SenderError("Touch the Upgrade Bench first.");
  }
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const itemId = canonicalItemId(args.itemId);
  if (!itemId || !isRefinableItem(itemId)) throw new SenderError("That item cannot be refined.");
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress || !deps.inventoryForProgress(progress).includes(itemId)) throw new SenderError("That item is not in your inventory.");
  const copyId = args.copyId;
  if (copyId !== 0n) {
    const copy = ctx.db.playerEquipmentCopy.id.find(copyId);
    if (!copy || !copy.identity.isEqual(ctx.sender) || copy.itemId !== itemId) throw new SenderError("That copy is not in your inventory.");
  }
  const from = refineLevelFor(ctx, ctx.sender, itemId, copyId);
  if (from !== normalizeRefineLevel(args.expectedLevel)) throw new SenderError("That item's refine changed. Try again.");
  if (from >= REFINE_MAX) throw new SenderError(`That item is already +${REFINE_MAX}.`);
  const cost = refineCost(itemId, from + 1)!;
  if (!takeOres(ctx, ctx.sender, cost)) throw new SenderError(`You need ${oreList(cost)}.`);
  const { succeeded, level } = rollRefine(itemId, from, ctx.random());
  setRefineLevel(ctx, ctx.sender, itemId, copyId, level);
  const previous = ctx.db.playerRefineResult.identity.find(ctx.sender);
  const result = { identity: ctx.sender, itemId, copyId, fromLevel: from, toLevel: level, succeeded,
    attempt: ((previous?.attempt ?? 0) + 1) % 4_294_967_296, triedAt: ctx.timestamp };
  if (previous) ctx.db.playerRefineResult.identity.update(result);
  else ctx.db.playerRefineResult.insert(result);
  // The first copy is the one a slot holds: worn, its new level changes the player's power at once.
  if (copyId === 0n && equippedFields(progress).includes(itemId)) deps.writeProgressAndPresentation(ctx, progress);
}

/** The caller's own copy refines, ores and last try, and the refine try itself. */
export function registerItemRefine(spacetimedb: typeof spacetimedbType, deps: ItemRefineDeps) {
  const refineItem = spacetimedb.reducer({ itemId: t.string(), copyId: t.u64(), expectedLevel: t.u8() },
    (ctx: any, args: { itemId: string; copyId: bigint; expectedLevel: number }) => refineItemFor(ctx, args, deps));
  const myCopyRefines = spacetimedb.view({ name: "my_copy_refines", public: true }, t.array(playerCopyRefine.rowType),
    (ctx: any) => [...ctx.db.playerCopyRefine.identity.filter(ctx.sender)]);
  const myOres = spacetimedb.view({ name: "my_ores", public: true }, t.array(playerOre.rowType),
    (ctx: any) => [...ctx.db.playerOre.identity.filter(ctx.sender)]);
  const myRefineResult = spacetimedb.view({ name: "my_refine_result", public: true }, t.array(playerRefineResult.rowType), (ctx: any) => {
    const row = ctx.db.playerRefineResult.identity.find(ctx.sender);
    return row ? [row] : [];
  });
  return { refineItem, myCopyRefines, myOres, myRefineResult };
}
