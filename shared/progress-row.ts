import { WIDE_STAT_FIELDS, narrowStat, needsWideStats, wideStatsApply } from "./wide-stats";

/**
 * How a player_progress row is stored, read the same way by the server and the client.
 *
 * Its maxHp, damage, armor and regen are f32. While any of them is past f32's range, all four full
 * values sit in the row's own *Wide f64 columns (0 otherwise); a value written to the f32 column since
 * wins. The bag (inventoryJson, cosmeticItemsJson) lives in player_inventory: the progress
 * row is written on nearly every kill report and sent to its owner each time, and the bag rarely
 * changes. A non-empty bag column on the row is a save not yet moved, or a direct write, and wins.
 */
export type WideColumns = { maxHpWide?: number; damageWide?: number; armorWide?: number; regenWide?: number };
type Stats = { maxHp: number; damage: number; armor: number; regen: number };
export type StoredBag = { inventoryJson: string; cosmeticItemsJson: string };

const WIDE_COLUMNS = { maxHp: "maxHpWide", damage: "damageWide", armor: "armorWide", regen: "regenWide" } as const;

/** The row with its full-precision stats laid back over the f32 columns. */
export function progressWithWideColumns<T extends Stats & WideColumns>(row: T): T {
  if (!(row.maxHpWide || row.damageWide || row.armorWide || row.regenWide)) return row;
  return wideStatsApply(row, { maxHp: row.maxHpWide ?? 0, damage: row.damageWide ?? 0, armor: row.armorWide ?? 0, regen: row.regenWide ?? 0 });
}

/** The stat columns to store: f32 clamped, and every full value in its *Wide column while any passes f32. */
export function progressStatColumns(row: Stats) {
  const wide = needsWideStats(row);
  const columns: Record<string, number> = {};
  for (const field of WIDE_STAT_FIELDS) {
    columns[field] = narrowStat(row[field]);
    columns[WIDE_COLUMNS[field]] = wide ? row[field] : 0;
  }
  return columns as Stats & Required<WideColumns>;
}

/** The row with its bag, column by column: its own when set, else player_inventory's, else empty. */
export function progressWithBag<T extends Partial<StoredBag>>(row: T, bag: StoredBag | null | undefined): T & StoredBag {
  return { ...row, inventoryJson: row.inventoryJson || bag?.inventoryJson || "[]",
    cosmeticItemsJson: row.cosmeticItemsJson || bag?.cosmeticItemsJson || "[]" } as T & StoredBag;
}
