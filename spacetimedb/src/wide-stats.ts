import { DUEL_WIDE_FIELDS, REPLAY_WIDE_FIELDS, applyWideFields, atWideClamp, splitWideFields } from "../../shared/wide-stats";
import { progressStatColumns, progressWithBag, progressWithWideColumns, type StoredBag } from "../../shared/progress-row";
import { cleanRating } from "../../shared/stat-rating";

/**
 * Every read of player_progress goes through readPlayerProgress / iterPlayerProgress and every write
 * through snapshot-row-writes.ts (writeProgressRow below), so the way the row is stored
 * (shared/progress-row.ts) stays in these few functions: stats past f32 in its *Wide columns, the
 * crit rating in critRating, and the bag in player_inventory.
 */

type Ctx = { db: any };
type Progress = { identity: any; maxHp: number; damage: number; armor: number; regen: number };

/** A stored player_progress row as the game uses it: full stats, the crit rating and the bag. */
function readRow(ctx: Ctx, row: any) {
  if (!row) return row;
  const bag = ctx.db.playerInventory?.identity.find(row.identity);
  const full = progressWithBag(progressWithWideColumns(row), bag);
  return { ...full, critRating: cleanRating(full.critRating ?? 0) };
}

/**
 * Stores a progress row: f32 stats clamped with full values beside them, the crit rating cleaned, and
 * the bag in player_inventory when it changed. Returns the row as player_progress keeps it.
 */
export function writeProgressRow<T extends Progress>(ctx: Ctx, written: T): T {
  // A row built from a stored one still carries its *Wide columns; keep what is behind a clamp.
  const row = progressWithWideColumns(written as T & Record<string, any>) as T & Partial<StoredBag> & { critRating?: number };
  const bag = { inventoryJson: row.inventoryJson || "[]", cosmeticItemsJson: row.cosmeticItemsJson || "[]" };
  if (ctx.db.playerInventory) {
    const existing = ctx.db.playerInventory.identity.find(row.identity);
    const next = { identity: row.identity, ...bag };
    if (!existing) ctx.db.playerInventory.insert(next);
    else if (existing.inventoryJson !== bag.inventoryJson || existing.cosmeticItemsJson !== bag.cosmeticItemsJson) ctx.db.playerInventory.identity.update(next);
  }
  return { ...row, ...progressStatColumns(row), critRating: cleanRating(row.critRating ?? 0),
    ...(ctx.db.playerInventory ? { inventoryJson: "", cosmeticItemsJson: "" } : {}) } as T;
}

/** A save's rows beside player_progress: its bag, and the retired side tables until they are dropped. */
export function deleteProgressExtras(ctx: Ctx, identity: any) {
  for (const table of [ctx.db.playerInventory, ctx.db.playerWideStats, ctx.db.playerCombatRating]) {
    if (table?.identity.find(identity)) table.identity.delete(identity);
  }
}

/** Migration 57: player_combat_rating and player_wide_stats copied onto their player_progress rows. */
export function moveCombatColumnsOntoProgress(ctx: any) {
  for (const rating of [...ctx.db.playerCombatRating?.iter() ?? []] as any[]) {
    const row = ctx.db.playerProgress.identity.find(rating.identity);
    if (row) ctx.db.playerProgress.identity.update({ ...row, critRating: rating.critDamage });
  }
  for (const wide of [...ctx.db.playerWideStats?.iter() ?? []] as any[]) {
    const row = ctx.db.playerProgress.identity.find(wide.identity);
    if (row) ctx.db.playerProgress.identity.update({ ...row, maxHpWide: wide.maxHp, damageWide: wide.damage, armorWide: wide.armor, regenWide: wide.regen });
  }
}

/** The run's crit damage rating: 0 without a save. */
export function readCritRating(ctx: Ctx, identity: any) {
  return cleanRating(ctx.db.playerProgress.identity.find(identity)?.critRating ?? 0);
}

/** The one way to read a player's progress. */
export function readPlayerProgress(ctx: Ctx, identity: any) {
  return readRow(ctx, ctx.db.playerProgress.identity.find(identity));
}

/** Every player's progress, read the same way. */
export function* iterPlayerProgress(ctx: Ctx): Generator<any> {
  for (const row of ctx.db.playerProgress.iter() as Iterable<any>) yield readRow(ctx, row);
}

/**
 * Stores a duel row's stats: the companion row when any passes the limit (and
 * drops a stale one when none does), and the row clamped for the duel table.
 * An insert has no id yet; it writes the companion row after (writeDuelWideAfterInsert).
 */
export function writeDuelWide<T extends Record<string, any>>(ctx: Ctx, written: T): T {
  // A row read without its wide stats still carries the clamp; keep what is behind it.
  const row = written.id ? withDuelWide(ctx, written) : written;
  const { narrowed, wideJson } = splitWideFields(row, DUEL_WIDE_FIELDS);
  if (row.id) storeDuelWide(ctx, row.id, row.challenger, wideJson);
  return narrowed;
}
export function writeDuelWideAfterInsert(ctx: Ctx, inserted: Record<string, any>, row: Record<string, any>) {
  storeDuelWide(ctx, inserted.id, inserted.challenger, splitWideFields(row, DUEL_WIDE_FIELDS).wideJson);
}
function storeDuelWide(ctx: Ctx, duelId: bigint, challenger: any, statsJson: string) {
  const existing = ctx.db.duelWideStats?.duelId.find(duelId);
  if (!statsJson) { if (existing) ctx.db.duelWideStats.duelId.delete(duelId); return; }
  const next = { duelId, challenger, statsJson };
  if (existing) ctx.db.duelWideStats.duelId.update(next); else ctx.db.duelWideStats?.insert(next);
}
export function deleteDuelWide(ctx: Ctx, duelId: bigint) {
  if (ctx.db.duelWideStats?.duelId.find(duelId)) ctx.db.duelWideStats.duelId.delete(duelId);
}

/** A duel row with its full-precision stats restored. Every duel read goes through this. */
export function withDuelWide<T extends Record<string, any> | null | undefined>(ctx: Ctx, row: T): T {
  if (!row || !atWideClamp(row, DUEL_WIDE_FIELDS)) return row;
  return applyWideFields(row, ctx.db.duelWideStats?.duelId.find(row.id)?.statsJson, DUEL_WIDE_FIELDS) as T;
}

/** A replay row ready to insert: clamped, with its companion row written when needed. */
export function writeReplayWide<T extends Record<string, any>>(ctx: Ctx, row: T): T {
  const { narrowed, wideJson } = splitWideFields(row, REPLAY_WIDE_FIELDS);
  const existing = ctx.db.duelReplayWideStats?.replayId.find(row.id);
  if (!wideJson) { if (existing) ctx.db.duelReplayWideStats.replayId.delete(row.id); }
  else if (existing) ctx.db.duelReplayWideStats.replayId.update({ replayId: row.id, statsJson: wideJson });
  else ctx.db.duelReplayWideStats?.insert({ replayId: row.id, statsJson: wideJson });
  return narrowed;
}
export function deleteReplayWide(ctx: Ctx, replayId: bigint) {
  if (ctx.db.duelReplayWideStats?.replayId.find(replayId)) ctx.db.duelReplayWideStats.replayId.delete(replayId);
}
