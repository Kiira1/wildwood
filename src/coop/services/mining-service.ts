import { tables, type DbConnection } from "../../module_bindings";
import { miningGain, miningNode, miningYield, normalizeMining } from "../../../shared/mining";
import type { OreId } from "../../../shared/refine";
import { reducerErrorMessage } from "./reducer-errors";
import { withRequestDeadline } from "./request-deadline";
import { createGatherQueue } from "./gather-queue";

export type MiningResult = { ok: boolean; error?: string };
type Target = { connection: DbConnection; isCurrent: () => boolean };
type Ores = Partial<Record<OreId, number>>;
const toMs = (at: { microsSinceUnixEpoch: bigint }) => Number(at.microsSinceUnixEpoch / 1000n);
const U32 = 4_294_967_296;

/** "2 broken rocks did not count.": breaks the server did not take, whose rocks stand again. */
export const miningRejectedText = (count: number) => `${count === 1 ? "A broken rock" : `${count} broken rocks`} did not count.`;

/**
 * This account's mining, from the caller-scoped my_mining and my_mined_nodes views: the Mining stat and when each of
 * the player's bare rocks was broken. Rocks break here at once and go to the server in batches (report_mining, through
 * gather-queue.ts); until it answers, the Mining, the bare rocks and the ores read here include them, as the shared
 * rules give them. A break the server does not take drops out, and its rock stands again.
 */
export function createMiningRows(notify: () => void) {
  let target: Target | null = null;
  let mining = 0, rocksBroken = 0;
  let broken = new Map<number, number>();
  /** Breaks not answered yet: when each rock broke, and the Mining and ore they add. */
  let local = { broken: new Map<number, number>(), gain: 0, ores: {} as Ores };
  /** Breaks the server answered since connecting, and how many of them it was told did not count. */
  let counted = { base: 0, sent: 0, reported: 0 };
  let rejectedListener: ((text: string) => void) | null = null;

  const queue = createGatherQueue({
    send(claims) {
      const current = target;
      if (!current || !current.isCurrent() || !current.connection.isActive) return null;
      return current.connection.reducers.reportMining({ breaks: claims.map(claim => ({ nodeId: claim.id, atMs: BigInt(Math.round(claim.atMs)) })) });
    },
    settled(claims, error) {
      if (error) { rejectedListener?.(error); return; }
      // Each break taken counts up rocksBroken, and its row arrives before the reply.
      counted.sent += claims.length;
      const rejected = counted.sent - (rocksBroken - counted.base + U32) % U32;
      if (rejected > counted.reported) rejectedListener?.(miningRejectedText(rejected - counted.reported));
      counted.reported = Math.max(counted.reported, rejected);
    },
    changed() {
      const next = { broken: new Map<number, number>(), gain: 0, ores: {} as Ores };
      for (const claim of queue.pending()) {
        const node = miningNode(claim.id);
        if (!node) continue;
        next.broken.set(node.id, Math.max(next.broken.get(node.id) ?? -Infinity, claim.atMs));
        next.gain += miningGain(node);
        // Before cards and the pickaxe's bonus, which the server rolls: the rock's ore, and a Mysterious rock's Starshard.
        for (const [oreId, count] of Object.entries(miningYield(node, 1))) next.ores[oreId as OreId] = (next.ores[oreId as OreId] ?? 0) + (count ?? 0);
      }
      local = next;
      notify();
    },
  });

  function watch(connection: DbConnection, isCurrent: () => boolean) {
    queue.clear();
    target = { connection, isCurrent };
    mining = 0; rocksBroken = 0; broken = new Map();
    const readMining = () => {
      if (!isCurrent()) return;
      const [row] = [...connection.db.myMining.iter()];
      mining = normalizeMining(row?.mining);
      rocksBroken = row?.rocksBroken ?? 0;
      notify();
    };
    const readBroken = () => {
      if (!isCurrent()) return;
      const next = new Map<number, number>();
      for (const row of connection.db.myMinedNodes.iter()) next.set(row.nodeId, toMs(row.brokenAt));
      broken = next;
      notify();
    };
    connection.db.myMining.onInsert(readMining); connection.db.myMining.onUpdate(readMining); connection.db.myMining.onDelete(readMining);
    connection.db.myMinedNodes.onInsert(readBroken); connection.db.myMinedNodes.onUpdate(readBroken); connection.db.myMinedNodes.onDelete(readBroken);
    connection.subscriptionBuilder()
      .onApplied(() => { readMining(); readBroken(); counted = { base: rocksBroken, sent: 0, reported: 0 }; })
      .subscribe([tables.myMining, tables.myMinedNodes]);
  }

  async function call(send: (connection: DbConnection) => Promise<unknown>): Promise<MiningResult> {
    const current = target;
    if (!current || !current.isCurrent() || !current.connection.isActive) return { ok: false, error: "NOT CONNECTED" };
    try {
      await withRequestDeadline(send(current.connection));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: reducerErrorMessage(error) };
    }
  }

  return {
    watch,
    /** Ore from breaks the server has not answered yet, to add to the bag's. */
    pendingOres: (): Readonly<Ores> => local.ores,
    api: {
      /** The Mining stat, with breaks not answered yet: 0 before the first rock. */
      mining: () => mining + local.gain,
      /** When the player last broke this rock, in epoch ms, here or on the server's list; null when neither has it. */
      minedNodeAt: (nodeId: number): number | null => {
        const server = broken.get(nodeId), here = local.broken.get(nodeId);
        return server === undefined ? here ?? null : here === undefined ? server : Math.max(server, here);
      },
      /** A rock broken here at `atMs` (the server's clock), for the next report. */
      queueMiningBreak: (nodeId: number, atMs: number) => queue.add({ id: nodeId, atMs }),
      /** Sends the breaks waiting now, ahead of anything that reads ores on the server. */
      flushMining: () => queue.flush(),
      /** Told when breaks did not count, or a report failed. */
      setOnMiningRejected(callback: ((text: string) => void) | null) { rejectedListener = callback; },
      /** A graded piece from the Smith for gold, at the price the player saw. */
      buyGradeGear: (itemId: string, expectedPrice: number) =>
        call(connection => connection.reducers.buyGradeGear({ itemId, expectedPrice: BigInt(expectedPrice) })),
    },
  };
}
