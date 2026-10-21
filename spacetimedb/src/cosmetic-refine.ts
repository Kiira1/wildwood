import { table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import { cosmeticUnlocks } from "../../shared/cosmetic-conversion";
import { normalizeRefineLevel } from "../../shared/refine";
import { readPlayerProgress } from "./wide-stats";

/**
 * The best refine an unlocked cosmetic's item was held at, so the look keeps its ★10/★20 art after the item is
 * sold, destroyed or reset away. Raised on conversion and whenever a copy's refine changes; never lowered.
 * +0 has no row. Its own public table, like player_item_refine, so profiles can draw another player's look
 * and no column moves on a table clients already read.
 */
export const playerCosmeticRefine = table({ name: "player_cosmetic_refine", public: true }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  itemId: t.string(),
  level: t.u8(),
});

type Ctx = any;

const itemKey = (identity: { toHexString(): string }, itemId: string) => `${identity.toHexString()}:${itemId}`;

/** The highest refine among the player's copies of an item. */
export function bestHeldRefine(ctx: Ctx, identity: Identity, itemId: string) {
  let best = normalizeRefineLevel(ctx.db.playerItemRefine.key.find(itemKey(identity, itemId))?.level);
  for (const row of ctx.db.playerCopyRefine.identity.filter(identity) as Iterable<any>) {
    if (row.itemId === itemId) best = Math.max(best, normalizeRefineLevel(row.level));
  }
  return best;
}

/** Raises the stored look refine to `level`. `unlocked` skips the progress read when the caller already knows. */
export function rememberCosmeticRefine(ctx: Ctx, identity: Identity, itemId: string, level: number, unlocked?: boolean) {
  const next = normalizeRefineLevel(level);
  if (!next) return;
  const key = itemKey(identity, itemId), current = ctx.db.playerCosmeticRefine.key.find(key);
  if (current && normalizeRefineLevel(current.level) >= next) return;
  if (!(unlocked ?? cosmeticUnlocks(readPlayerProgress(ctx, identity)?.cosmeticItemsJson).includes(itemId))) return;
  if (current) ctx.db.playerCosmeticRefine.key.update({ ...current, level: next });
  else ctx.db.playerCosmeticRefine.insert({ key, identity, itemId, level: next });
}

/** A guest's looks join the account's on link (the unlock lists are merged), each keeping the higher refine. */
export function mergeCosmeticRefines(ctx: Ctx, guest: Identity, account: Identity) {
  for (const row of [...ctx.db.playerCosmeticRefine.identity.filter(guest)] as any[]) {
    ctx.db.playerCosmeticRefine.key.delete(row.key);
    const key = itemKey(account, row.itemId), current = ctx.db.playerCosmeticRefine.key.find(key);
    if (!current) ctx.db.playerCosmeticRefine.insert({ ...row, key, identity: account });
    else if (current.level < row.level) ctx.db.playerCosmeticRefine.key.update({ ...current, level: row.level });
  }
}

/** The caller's own look refines; another player's are read from player_cosmetic_refine by identity (profiles). */
export function registerCosmeticRefine(spacetimedb: typeof spacetimedbType) {
  const myCosmeticRefines = spacetimedb.view({ name: "my_cosmetic_refines", public: true }, t.array(playerCosmeticRefine.rowType),
    (ctx: any) => [...ctx.db.playerCosmeticRefine.identity.filter(ctx.sender)]);
  return { myCosmeticRefines };
}
