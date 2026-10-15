import { DUEL_WIDE_FIELDS, REPLAY_WIDE_FIELDS, applyWideFields } from "../../../shared/wide-stats";
import { progressWithBag, progressWithWideColumns, type StoredBag, type WideColumns } from "../../../shared/progress-row";

type Identified = { identity: { toHexString(): string } };
type Stats = { maxHp: number; damage: number; armor: number; regen: number };
type Connection = { db: { playerInventory?: { iter(): Iterable<Identified & StoredBag> } } };

/**
 * A player_progress row as the server reads it (shared/progress-row.ts): full stats from its wide
 * columns, its crit rating, and its bag from player_inventory. Only subscribed players' bags are
 * here, so the scan is of a handful of rows.
 */
export function withWideProgress<T extends Identified & Stats & WideColumns & Partial<StoredBag> & { critRating?: number }>(connection: Connection, row: T): T & StoredBag & { critRating: number } {
  const id = row.identity.toHexString();
  let bag: StoredBag | undefined;
  for (const candidate of connection.db.playerInventory?.iter() ?? []) {
    if (candidate.identity.toHexString() === id) { bag = candidate; break; }
  }
  const full = progressWithBag(progressWithWideColumns(row), bag);
  return { ...full, critRating: full.critRating ?? 0 };
}

type WideRows = { iter(): Iterable<{ statsJson: string } & Record<string, any>> };

/** A duel row with its stats past f32 from duel_wide_stats laid over it, as the server reads it. */
export function withWideDuel<T extends { id: bigint } & Record<string, any>>(connection: { db: { duelWideStats?: WideRows } }, row: T): T {
  for (const wide of connection.db.duelWideStats?.iter() ?? []) if (wide.duelId === row.id) return applyWideFields(row, wide.statsJson, DUEL_WIDE_FIELDS);
  return row;
}

/** A replay row with its stats past f32 from duel_replay_wide_stats laid over it. */
export function withWideReplay<T extends { id: bigint } & Record<string, any>>(connection: { db: { duelReplayWideStats?: WideRows } }, row: T): T {
  for (const wide of connection.db.duelReplayWideStats?.iter() ?? []) if (wide.replayId === row.id) return applyWideFields(row, wide.statsJson, REPLAY_WIDE_FIELDS);
  return row;
}
