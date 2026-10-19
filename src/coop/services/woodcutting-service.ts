import { tables, type DbConnection } from "../../module_bindings";
import { normalizeWoodcutting } from "../../../shared/woodcutting";
import { reducerErrorMessage } from "./reducer-errors";
import { withRequestDeadline } from "./request-deadline";

/** A tree the server took as felled (player_woodcutting's last chop), for the "+2 Pine Log" over it. */
export type TreeChop = { treeId: number; treesChopped: number };
export type WoodcuttingResult = { ok: boolean; error?: string };

type Target = { connection: DbConnection; isCurrent: () => boolean };
const toMs = (at: { microsSinceUnixEpoch: bigint }) => Number(at.microsSinceUnixEpoch / 1000n);

/**
 * This account's woodcutting, from the caller-scoped my_woodcutting and my_chopped_trees views, as mining's
 * (mining-service.ts): the Woodcutting stat and when each stump was felled. Chops go through the chop_tree reducer;
 * the server judges each.
 */
export function createWoodcuttingRows(notify: () => void) {
  let target: Target | null = null;
  let woodcutting = 0;
  let last: TreeChop | null = null;
  let felled = new Map<number, number>();
  let chopListener: ((result: TreeChop) => void) | null = null;

  function watch(connection: DbConnection, isCurrent: () => boolean) {
    target = { connection, isCurrent };
    woodcutting = 0; last = null; felled = new Map();
    // The row found on connect is an old chop, not one to announce.
    let hydrated = false;
    const readWoodcutting = () => {
      if (!isCurrent()) return;
      const [row] = [...connection.db.myWoodcutting.iter()];
      const previous = last;
      woodcutting = normalizeWoodcutting(row?.woodcutting);
      last = row && row.treesChopped > 0 ? { treeId: row.lastTreeId, treesChopped: row.treesChopped } : null;
      notify();
      if (hydrated && last && last.treesChopped !== previous?.treesChopped) chopListener?.(last);
    };
    const readFelled = () => {
      if (!isCurrent()) return;
      const next = new Map<number, number>();
      for (const row of connection.db.myChoppedTrees.iter()) next.set(row.treeId, toMs(row.choppedAt));
      felled = next;
      notify();
    };
    connection.db.myWoodcutting.onInsert(readWoodcutting); connection.db.myWoodcutting.onUpdate(readWoodcutting); connection.db.myWoodcutting.onDelete(readWoodcutting);
    connection.db.myChoppedTrees.onInsert(readFelled); connection.db.myChoppedTrees.onUpdate(readFelled); connection.db.myChoppedTrees.onDelete(readFelled);
    connection.subscriptionBuilder()
      .onApplied(() => { readWoodcutting(); readFelled(); hydrated = true; })
      .subscribe([tables.myWoodcutting, tables.myChoppedTrees]);
  }

  async function call(send: (connection: DbConnection) => Promise<unknown>): Promise<WoodcuttingResult> {
    const current = target;
    if (!current || !current.isCurrent() || !current.connection.isActive) return { ok: false, error: "NOT CONNECTED" };
    try {
      // A call cut off by a dropped connection never settles: without a deadline the next tree would wait for it forever.
      await withRequestDeadline(send(current.connection));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: reducerErrorMessage(error) };
    }
  }

  return {
    watch,
    api: {
      /** The Woodcutting stat: 0 before the first tree. */
      woodcutting: () => woodcutting,
      /** When the player felled this tree, in epoch ms, while it is still on the server's list; null when they have not. */
      choppedTreeAt: (treeId: number): number | null => felled.get(treeId) ?? null,
      /** Called with each new chop the server takes (not the standing row found on connect). */
      setOnTreeChopped(callback: ((result: TreeChop) => void) | null) { chopListener = callback; },
      chopTree: (treeId: number) => call(connection => connection.reducers.chopTree({ treeId })),
    },
  };
}
