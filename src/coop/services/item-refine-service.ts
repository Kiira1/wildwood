import { tables, type DbConnection } from "../../module_bindings";
import { REFINE_ORES, normalizeRefineLevel, type OreId } from "../../../shared/refine";
import type { ItemLevel } from "../../../shared/items";
import { reducerErrorMessage } from "./reducer-errors";

/** What the last refine try did, as the server recorded it (player_refine_result). */
export type RefineResult = {
  itemId: string; copyId: bigint; fromLevel: number; toLevel: number; succeeded: boolean; attempt: number; triedAtMs: number;
};
export type RefineTryResult = { ok: boolean; error?: string };

type Target = { connection: DbConnection; isCurrent: () => boolean };
const copyKey = (itemId: string, copyId: bigint) => `${itemId}:${copyId}`;
const isOreId = (value: string): value is OreId => Object.prototype.hasOwnProperty.call(REFINE_ORES, value);

/**
 * This account's refines, ores and last refine try, from the caller-scoped my_item_refines, my_copy_refines,
 * my_ores and my_refine_result views, and the refine_item reducer. The server rolls every try and owns every
 * level; this only carries rows and requests.
 */
export function createItemRefineRows(notify: () => void, slotTierFor: (itemId: string) => number = () => 0) {
  let target: Target | null = null;
  let levels = new Map<string, number>();
  let ores: Partial<Record<OreId, number>> = {};
  let result: RefineResult | null = null;
  let resultListener: ((result: RefineResult) => void) | null = null;

  function watch(connection: DbConnection, isCurrent: () => boolean) {
    target = { connection, isCurrent };
    levels = new Map();
    ores = {};
    result = null;
    // The standing row on connect is an old try, not one to announce.
    let hydrated = false;
    const readLevels = () => {
      if (!isCurrent()) return;
      const next = new Map<string, number>();
      for (const row of connection.db.myItemRefines.iter()) next.set(copyKey(row.itemId, 0n), normalizeRefineLevel(row.level));
      for (const row of connection.db.myCopyRefines.iter()) next.set(copyKey(row.itemId, row.copyId), normalizeRefineLevel(row.level));
      levels = next;
      notify();
    };
    const readOres = () => {
      if (!isCurrent()) return;
      const next: Partial<Record<OreId, number>> = {};
      for (const row of connection.db.myOres.iter()) if (isOreId(row.oreId)) next[row.oreId] = row.count;
      ores = next;
      notify();
    };
    const readResult = () => {
      if (!isCurrent()) return;
      const [row] = [...connection.db.myRefineResult.iter()];
      const previous = result;
      result = row ? {
        itemId: row.itemId, copyId: row.copyId, fromLevel: row.fromLevel, toLevel: row.toLevel, succeeded: row.succeeded,
        attempt: row.attempt, triedAtMs: Number(row.triedAt.microsSinceUnixEpoch / 1000n),
      } : null;
      notify();
      if (hydrated && result && result.attempt !== previous?.attempt) resultListener?.(result);
    };
    for (const view of [connection.db.myItemRefines, connection.db.myCopyRefines]) {
      view.onInsert(readLevels); view.onUpdate(readLevels); view.onDelete(readLevels);
    }
    connection.db.myOres.onInsert(readOres); connection.db.myOres.onUpdate(readOres); connection.db.myOres.onDelete(readOres);
    connection.db.myRefineResult.onInsert(readResult); connection.db.myRefineResult.onUpdate(readResult); connection.db.myRefineResult.onDelete(readResult);
    connection.subscriptionBuilder()
      .onApplied(() => { readLevels(); readOres(); readResult(); hydrated = true; })
      .subscribe([tables.myItemRefines, tables.myCopyRefines, tables.myOres, tables.myRefineResult]);
  }

  return {
    watch,
    api: {
      /** One copy's refine level: copy id 0 is the first copy, the one a slot holds. */
      itemRefine: (itemId: string, copyId = 0n) => levels.get(copyKey(itemId, copyId)) ?? 0,
      /**
       * What one of our items' stats stand on (items.ts ItemLevel): its slot's tier and the first copy's refine, the
       * copy a slot holds. Everything that works stats out reads this; the +N label still reads the tier alone.
       */
      itemLevel: (itemId: string): ItemLevel => ({ tier: slotTierFor(itemId), refine: levels.get(copyKey(itemId, 0n)) ?? 0 }),
      /** Ores held, by kind; a kind not held is missing. */
      ores: (): Readonly<Partial<Record<OreId, number>>> => ores,
      lastRefineResult: (): RefineResult | null => result,
      /** Called with each new try's result, once the window has asked for it (not for the standing row on connect). */
      setOnRefineResult(callback: ((result: RefineResult) => void) | null) { resultListener = callback; },
      /** One try. `expectedLevel` is the level the player saw, so a double tap cannot spend a second ore. */
      async refineItem(itemId: string, copyId: bigint, expectedLevel: number): Promise<RefineTryResult> {
        const current = target;
        if (!current || !current.isCurrent() || !current.connection.isActive) return { ok: false, error: "NOT CONNECTED" };
        try {
          await current.connection.reducers.refineItem({ itemId, copyId, expectedLevel });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: reducerErrorMessage(error) };
        }
      },
    },
  };
}
