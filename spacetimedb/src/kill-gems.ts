import { table, t, SenderError } from "spacetimedb/server";
import { gemKillCredit, settleGemKillCredit } from "../../shared/gem-drops";

/**
 * Each player's kill gems a UTC day: the kills paid, the gems they made, and the first and last report. It
 * replaced a ledger row per payout (one per 1,200 kills, 250,000 rows by 2026-10-15) for the kill-rate audit
 * (scripts/audit-kill-rates.ts); the server's own sustained_kill_rate moderation covers the minute-by-minute.
 */
export const gemKillDaily = table({ name: "gem_kill_daily", public: false,
  indexes: [{ accessor: "byIdentity", algorithm: "btree", columns: ["identity"] as const }] }, {
  key: t.string().primaryKey(),
  identity: t.identity(),
  dayKey: t.string(),
  kills: t.u64(),
  gems: t.u64(),
  firstAt: t.timestamp(),
  lastAt: t.timestamp(),
});

/**
 * Where the clearing of the old per-payout ledger rows has got to: gem_transaction ids are walked from
 * `nextId` to `endId` (the last id when it began) a batch a minute, and kill-gem rows deleted. Retroactive
 * grants (kill-gems:retro:…) stay. `done` once it is through.
 */
export const gemLedgerTrim = table({ name: "gem_ledger_trim", public: false }, {
  id: t.u8().primaryKey(),
  nextId: t.u64(),
  endId: t.u64(),
  done: t.bool(),
});
/** Ledger ids looked at a minute: the ~460,000 ids live on 2026-10-15 clear in about an hour and a half. */
const LEDGER_TRIM_BATCH = 5_000n;

// Gems paid for enemy kills. The gem_kill_progress and player_gem_drop tables,
// the schema registration and the dev_grant_retroactive_kill_gems reducer
// declaration stay in index.ts; this module owns the bodies they call. The
// wallet write arrives through deps so the code here reads the same as it did
// in the entry module.

export type KillGemsDeps = {
  creditGemsWithoutLedger: (ctx: any, identity: any, delta: bigint) => unknown;
};

export function createKillGems(deps: KillGemsDeps) {
  const { creditGemsWithoutLedger } = deps;

  /**
   * Turn accepted kills into gem credit and pay out whole gems. The kill report
   * is replay-safe by its stream cursor, so a replayed batch never gets here twice.
   */
  function grantKillGems(ctx: any, identity: any, acceptedDefeats: number, _lifetimeKillsAfter: bigint) {
    const earned = gemKillCredit(acceptedDefeats);
    if (earned === 0n) return 0n;
    const progress = ctx.db.gemKillProgress.identity.find(identity);
    const settled = settleGemKillCredit((progress?.credit ?? 0n) + earned);
    const row = { identity, credit: settled.remainder };
    if (progress) ctx.db.gemKillProgress.identity.update(row); else ctx.db.gemKillProgress.insert(row);
    recordKillDay(ctx, identity, acceptedDefeats, settled.gems);
    if (settled.gems === 0n) return 0n;
    creditGemsWithoutLedger(ctx, identity, settled.gems);
    publishGemDrop(ctx, identity, settled.gems);
    return settled.gems;
  }

  function recordKillDay(ctx: any, identity: any, kills: number, gems: bigint) {
    const dayKey = String(ctx.timestamp.microsSinceUnixEpoch / 86_400_000_000n);
    const key = `${identity.toHexString()}:${dayKey}`;
    const day = ctx.db.gemKillDaily.key.find(key);
    if (day) ctx.db.gemKillDaily.key.update({ ...day, kills: day.kills + BigInt(kills), gems: day.gems + gems, lastAt: ctx.timestamp });
    else ctx.db.gemKillDaily.insert({ key, identity, dayKey, kills: BigInt(kills), gems, firstAt: ctx.timestamp, lastAt: ctx.timestamp });
  }

  /** One batch of the old ledger's clearing (gem_ledger_trim), from the minute's maintenance. */
  function trimKillGemLedger(ctx: any) {
    let state = ctx.db.gemLedgerTrim.id.find(0);
    if (state?.done) return;
    if (!state) {
      // The last id when the clearing begins: no kill gem is written to the ledger after this release.
      let endId = 0n;
      for (const row of ctx.db.gemTransaction.iter() as Iterable<any>) if (row.id > endId) endId = row.id;
      state = ctx.db.gemLedgerTrim.insert({ id: 0, nextId: 0n, endId, done: false });
    }
    const stop = state.nextId + LEDGER_TRIM_BATCH;
    let removed = 0;
    for (let id = state.nextId; id < stop && id <= state.endId; id++) {
      const row = ctx.db.gemTransaction.id.find(id);
      if (row && row.kind === "enemy_kills" && !String(row.externalReference).includes(":retro:")) {
        ctx.db.gemTransaction.id.delete(id);
        removed++;
      }
    }
    const done = stop > state.endId;
    ctx.db.gemLedgerTrim.id.update({ ...state, nextId: stop, done });
    if (done) console.log(`Kill-gem ledger cleared through id ${state.endId}.`);
    return removed;
  }

  // player_gem_drop is an event table: rows are delivered, not kept, so there
  // is no prior row to count from. The timestamp is the sequence; it only rises.
  function publishGemDrop(ctx: any, identity: any, gems: bigint) {
    ctx.db.playerGemDrop.insert({ identity, amount: Number(gems), sequence: ctx.timestamp.microsSinceUnixEpoch, droppedAt: ctx.timestamp });
  }

  /**
   * The one-time catch-up for kills earned before kill gems existed has run. It counted what each player had
   * been paid from the per-payout ledger rows, which are no longer kept: run again it would pay everyone twice.
   */
  function grantRetroactiveKillGems(_ctx: any): never {
    throw new SenderError("The retroactive kill-gem grant has already run, and its ledger is gone.");
  }

  return { grantKillGems, grantRetroactiveKillGems, trimKillGemLedger };
}
