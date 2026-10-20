import { tables, type DbConnection } from "../../module_bindings";
import { normalizeWoodcutting, woodcuttingGain, woodcuttingYield, woodTree } from "../../../shared/woodcutting";
import type { OreId } from "../../../shared/refine";
import { createGatherQueue, createReportGains, gatherExtras } from "./gather-queue";

type Target = { connection: DbConnection; isCurrent: () => boolean };
type Ores = Partial<Record<OreId, number>>;
const toMs = (at: { microsSinceUnixEpoch: bigint }) => Number(at.microsSinceUnixEpoch / 1000n);
const U32 = 4_294_967_296;

/** "2 felled trees did not count.": falls the server did not take, whose trees stand again. */
export const woodcuttingRejectedText = (count: number) => `${count === 1 ? "A felled tree" : `${count} felled trees`} did not count.`;

/** What falls show at once, before the hatchet's bonus log, which the server rolls. */
function shownLogs(claims: readonly { id: number }[]) {
  const ores: Ores = {};
  for (const claim of claims) {
    const tree = woodTree(claim.id);
    if (!tree) continue;
    for (const [logId, count] of Object.entries(woodcuttingYield(tree))) ores[logId as OreId] = (ores[logId as OreId] ?? 0) + (count ?? 0);
  }
  return ores;
}

/**
 * This account's woodcutting, from the caller-scoped my_woodcutting and my_chopped_trees views, as mining's
 * (mining-service.ts): the Woodcutting stat and when each stump was felled. Trees fall here at once and go to the
 * server in batches (report_chopping); until it answers, the stat, the stumps and the logs read here include them.
 */
export function createWoodcuttingRows(notify: () => void) {
  let target: Target | null = null;
  let woodcutting = 0, treesChopped = 0;
  let felled = new Map<number, number>();
  /** Falls not answered yet: when each tree fell, and the Woodcutting and logs they add. */
  let local = { felled: new Map<number, number>(), gain: 0, ores: {} as Ores };
  let counted = { base: 0, sent: 0, reported: 0 };
  let rejectedListener: ((text: string) => void) | null = null;
  let extraListener: ((ores: Ores) => void) | null = null;
  const gains = createReportGains(), reports = new WeakMap<readonly unknown[], object>();

  const queue = createGatherQueue({
    send(claims) {
      const current = target;
      if (!current || !current.isCurrent() || !current.connection.isActive) return null;
      const args = gains.track({ chops: claims.map(claim => ({ treeId: claim.id, atMs: BigInt(Math.round(claim.atMs)) })) });
      reports.set(claims, args);
      return current.connection.reducers.reportChopping(args);
    },
    settled(claims, error) {
      const gained = gains.take(reports.get(claims));
      if (error) { rejectedListener?.(error); return; }
      // The hatchet's bonus logs, beyond what each fall showed.
      const extra = gained ? gatherExtras(gained, shownLogs(claims)) : {};
      if (Object.keys(extra).length) extraListener?.(extra);
      counted.sent += claims.length;
      const rejected = counted.sent - (treesChopped - counted.base + U32) % U32;
      if (rejected > counted.reported) rejectedListener?.(woodcuttingRejectedText(rejected - counted.reported));
      counted.reported = Math.max(counted.reported, rejected);
    },
    changed() {
      const pending = queue.pending(), next = { felled: new Map<number, number>(), gain: 0, ores: shownLogs(pending) };
      for (const claim of pending) {
        const tree = woodTree(claim.id);
        if (!tree) continue;
        next.felled.set(tree.id, Math.max(next.felled.get(tree.id) ?? -Infinity, claim.atMs));
        next.gain += woodcuttingGain(tree);
      }
      local = next;
      notify();
    },
  });

  function watch(connection: DbConnection, isCurrent: () => boolean) {
    queue.clear();
    target = { connection, isCurrent };
    woodcutting = 0; treesChopped = 0; felled = new Map();
    const readWoodcutting = () => {
      if (!isCurrent()) return;
      const [row] = [...connection.db.myWoodcutting.iter()];
      woodcutting = normalizeWoodcutting(row?.woodcutting);
      treesChopped = row?.treesChopped ?? 0;
      notify();
    };
    const readFelled = () => {
      if (!isCurrent()) return;
      const next = new Map<number, number>();
      for (const row of connection.db.myChoppedTrees.iter()) next.set(row.treeId, toMs(row.choppedAt));
      felled = next;
      notify();
    };
    connection.db.myWoodcutting.onInsert(readWoodcutting); connection.db.myWoodcutting.onUpdate(readWoodcutting); connection.db.myWoodcutting.onDelete(readWoodcutting);
    gains.watch(connection.db.myOres);
    connection.db.myChoppedTrees.onInsert(readFelled); connection.db.myChoppedTrees.onUpdate(readFelled); connection.db.myChoppedTrees.onDelete(readFelled);
    connection.subscriptionBuilder()
      .onApplied(() => { readWoodcutting(); readFelled(); counted = { base: treesChopped, sent: 0, reported: 0 }; })
      .subscribe([tables.myWoodcutting, tables.myChoppedTrees]);
  }

  return {
    watch,
    /** Logs from falls the server has not answered yet, to add to the bag's. */
    pendingOres: (): Readonly<Ores> => local.ores,
    api: {
      /** The Woodcutting stat, with falls not answered yet: 0 before the first tree. */
      woodcutting: () => woodcutting + local.gain,
      /** When the player last felled this tree, in epoch ms, here or on the server's list; null when neither has it. */
      choppedTreeAt: (treeId: number): number | null => {
        const server = felled.get(treeId), here = local.felled.get(treeId);
        return server === undefined ? here ?? null : here === undefined ? server : Math.max(server, here);
      },
      /** A tree felled here at `atMs` (the server's clock), for the next report. */
      queueTreeChop: (treeId: number, atMs: number) => queue.add({ id: treeId, atMs }),
      /** Sends the falls waiting now, ahead of anything that reads ores on the server. */
      flushWoodcutting: () => queue.flush(),
      /** Told when falls did not count, or a report failed. */
      setOnWoodcuttingRejected(callback: ((text: string) => void) | null) { rejectedListener = callback; },
      /** Told what a report gave beyond what its falls showed. */
      setOnWoodcuttingExtra(callback: ((ores: Ores) => void) | null) { extraListener = callback; },
    },
  };
}
