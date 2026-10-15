// Gem wallet: the wallet row, every balance change and its ledger entry, and
// the daily gem bonus state keyed by UTC day. Moved out of index.ts unchanged.
import { sameIdentity } from "./session-guards";
import { SenderError } from "spacetimedb/server";
import { gemBalanceAfter } from "../../shared/gems";

export function ensureGemWallet(ctx: any, identity: any) {
  const existing = ctx.db.playerGemWallet.identity.find(identity);
  if (existing) return existing;
  return ctx.db.playerGemWallet.insert({
    identity,
    balance: 0n,
    revision: 0n,
    updatedAt: ctx.timestamp,
  });
}

export function applyGemBalanceChange(ctx: any, input: {
  identity: any;
  delta: bigint;
  kind: string;
  note: string;
  externalReference: string;
}) {
  const duplicate = ctx.db.gemTransaction.externalReference.find(input.externalReference);
  if (duplicate) {
    if (!sameIdentity(duplicate.identity, input.identity) || duplicate.delta !== input.delta || duplicate.kind !== input.kind) {
      throw new SenderError("Gem transaction reference conflict.");
    }
    return ensureGemWallet(ctx, input.identity);
  }

  if (input.delta === 0n) throw new SenderError("Gem amount must not be zero.");
  if (input.delta < 0n && input.kind !== "gem_refund" &&
      [...ctx.db.gemCommerceHold.byIdentity.filter(input.identity)].length) {
    throw new SenderError("Gem spending is paused while a refunded purchase is reconciled.");
  }
  const wallet = ensureGemWallet(ctx, input.identity);
  let balanceAfter: bigint;
  try {
    balanceAfter = gemBalanceAfter(wallet.balance, input.delta);
  } catch (error) {
    throw new SenderError(error instanceof Error ? error.message : "Gem balance update failed.");
  }
  const nextWallet = {
    ...wallet,
    balance: balanceAfter,
    revision: wallet.revision + 1n,
    updatedAt: ctx.timestamp,
  };
  ctx.db.playerGemWallet.identity.update(nextWallet);
  ctx.db.gemTransaction.insert({
    id: 0n,
    identity: input.identity,
    delta: input.delta,
    balanceAfter,
    kind: input.kind,
    note: input.note,
    externalReference: input.externalReference,
    createdAt: ctx.timestamp,
  });
  return nextWallet;
}

/**
 * Gems added with no ledger row: kill gems, which are paid on nearly every kill report. Those reports are
 * replay-safe by their stream cursor, and gem_kill_daily keeps each player's kills and gems a day for audits.
 * Purchases, ads, spending and compensation keep their ledger rows through applyGemBalanceChange.
 */
export function creditGemsWithoutLedger(ctx: any, identity: any, delta: bigint) {
  if (delta <= 0n) throw new SenderError("Gem amount must be positive.");
  const wallet = ensureGemWallet(ctx, identity);
  let balance: bigint;
  try { balance = gemBalanceAfter(wallet.balance, delta); }
  catch (error) { throw new SenderError(error instanceof Error ? error.message : "Gem balance update failed."); }
  const next = { ...wallet, balance, revision: wallet.revision + 1n, updatedAt: ctx.timestamp };
  ctx.db.playerGemWallet.identity.update(next);
  return next;
}

export const UTC_DAY_MICROS = 86_400_000_000n;

export function currentUtcDayKey(ctx: any) {
  return String(ctx.timestamp.microsSinceUnixEpoch / UTC_DAY_MICROS);
}

export function legacyDailyGemBonusReference(identity: any, dayKey: string) {
  return `daily-login:${identity.toHexString()}:${dayKey}`;
}

export function ensureDailyGemBonusState(ctx: any, identity: any) {
  const dayKey = currentUtcDayKey(ctx);
  const current = ctx.db.dailyGemBonus.identity.find(identity);
  if (current?.claimableDayKey === dayKey || current?.lastClaimedDayKey === dayKey) return current;

  // v0.501 credited the reward immediately. Preserve that claim for ordinary
  // players so rollout of the Claim window can never double-credit a day.
  const legacyClaimed = Boolean(ctx.db.gemTransaction.externalReference.find(
    legacyDailyGemBonusReference(identity, dayKey),
  ));
  const next = {
    identity,
    claimableDayKey: legacyClaimed ? "" : dayKey,
    lastClaimedDayKey: legacyClaimed ? dayKey : current?.lastClaimedDayKey ?? "",
    claimCycle: current?.claimCycle ?? 0n,
    revision: (current?.revision ?? 0n) + 1n,
    updatedAt: ctx.timestamp,
  };
  if (current) ctx.db.dailyGemBonus.identity.update(next);
  else ctx.db.dailyGemBonus.insert(next);
  return next;
}
