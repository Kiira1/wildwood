import { tables, type DbConnection } from "../../module_bindings";
import { normalizeMining } from "../../../shared/mining";
import { reducerErrorMessage } from "./reducer-errors";
import { withRequestDeadline } from "./request-deadline";

/** A rock the server took as broken (player_mining's last break), for the "+3 Copper Ore" over it. */
export type MiningBreak = { nodeId: number; starshard: boolean; rocksBroken: number };
export type MiningResult = { ok: boolean; error?: string };

type Target = { connection: DbConnection; isCurrent: () => boolean };
const toMs = (at: { microsSinceUnixEpoch: bigint }) => Number(at.microsSinceUnixEpoch / 1000n);

/**
 * This account's mining, from the caller-scoped my_mining and my_mined_nodes views: the Mining stat, whether the
 * Smith has given the pickaxe, and when each of the player's bare rocks was broken. Breaks and the pickaxe go
 * through the mine_node and claim_pickaxe reducers; the server judges each and rolls the ore.
 */
export function createMiningRows(notify: () => void) {
  let target: Target | null = null;
  let mining = 0;
  let pickaxe = false;
  let last: MiningBreak | null = null;
  let broken = new Map<number, number>();
  let breakListener: ((result: MiningBreak) => void) | null = null;

  function watch(connection: DbConnection, isCurrent: () => boolean) {
    target = { connection, isCurrent };
    mining = 0; pickaxe = false; last = null; broken = new Map();
    // The row found on connect is an old break, not one to announce.
    let hydrated = false;
    const readMining = () => {
      if (!isCurrent()) return;
      const [row] = [...connection.db.myMining.iter()];
      const previous = last;
      mining = normalizeMining(row?.mining);
      pickaxe = Boolean(row);
      last = row && row.rocksBroken > 0 ? { nodeId: row.lastNodeId, starshard: row.lastStarshard, rocksBroken: row.rocksBroken } : null;
      notify();
      if (hydrated && last && last.rocksBroken !== previous?.rocksBroken) breakListener?.(last);
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
      .onApplied(() => { readMining(); readBroken(); hydrated = true; })
      .subscribe([tables.myMining, tables.myMinedNodes]);
  }

  async function call(send: (connection: DbConnection) => Promise<unknown>): Promise<MiningResult> {
    const current = target;
    if (!current || !current.isCurrent() || !current.connection.isActive) return { ok: false, error: "NOT CONNECTED" };
    try {
      // A call cut off by a dropped connection never settles: without a deadline the next rock would wait for it forever.
      await withRequestDeadline(send(current.connection));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: reducerErrorMessage(error) };
    }
  }

  return {
    watch,
    api: {
      /** The Mining stat: 0 before the Smith's pickaxe. */
      mining: () => mining,
      hasPickaxe: () => pickaxe,
      /** When the player broke this rock, in epoch ms, while it is still on the server's list; null when they have not. */
      minedNodeAt: (nodeId: number): number | null => broken.get(nodeId) ?? null,
      /** Called with each new break the server takes (not the standing row found on connect). */
      setOnMiningBreak(callback: ((result: MiningBreak) => void) | null) { breakListener = callback; },
      mineNode: (nodeId: number) => call(connection => connection.reducers.mineNode({ nodeId })),
      claimPickaxe: () => call(connection => connection.reducers.claimPickaxe({})),
      /** The Smith's Starter Staff, handed out like the pickaxe. */
      claimStarterStaff: () => call(connection => connection.reducers.claimStarterStaff({})),
    },
  };
}
