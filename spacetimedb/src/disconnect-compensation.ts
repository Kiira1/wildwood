import { SenderError } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type { ModuleReducerCtx } from "./index";

export const DISCONNECT_GIFT_CAMPAIGN = "disconnect-compensation:2026-09-14";
export const DISCONNECT_GIFT_AMOUNT = 20n;

type Credit = (input: { identity: Identity; delta: bigint; kind: string; note: string; externalReference: string }) => void;

/** Credit immediately; the existing apology popup only acknowledges receipt.
 * The ledger reference survives dismissal and makes retries safe. */
export function deliverDisconnectCompensation(ctx: ModuleReducerCtx, recipients: Identity[], credit: Credit) {
  deliverGemGift(ctx, recipients, credit, DISCONNECT_GIFT_CAMPAIGN, "disconnect_compensation",
    "20 gems from the developer. Sorry for the disconnect issues, and thanks for sticking with us!");
}

export const COMBAT_UPDATE_GIFT_CAMPAIGN = "combat-update:0.695";
export function deliverCombatUpdateGift(ctx: ModuleReducerCtx, recipients: Identity[], credit: Credit) {
  deliverGemGift(ctx, recipients, credit, COMBAT_UPDATE_GIFT_CAMPAIGN, "combat_update_gift",
    "20 gems from the developer for the combat changes. Thanks for testing WildStat!");
}

function deliverGemGift(ctx: ModuleReducerCtx, recipients: Identity[], credit: Credit, campaign: string, kind: string, note: string) {
  if (recipients.length > 100) throw new SenderError("Send at most 100 gifts at a time.");
  for (const identity of recipients) {
    if (!ctx.db.playerProgress.identity.find(identity) || ctx.db.virtualPlayer.identity.find(identity)) continue;
    const externalReference = `${campaign}:${identity.toHexString()}`;
    if (ctx.db.gemTransaction.externalReference.find(externalReference)) continue;
    credit({ identity, delta: DISCONNECT_GIFT_AMOUNT, kind, note, externalReference });
    const previous = ctx.db.balanceApologyNotice.identity.find(identity);
    if (previous) ctx.db.balanceApologyNotice.identity.update({ ...previous, amount: previous.amount + DISCONNECT_GIFT_AMOUNT });
    else ctx.db.balanceApologyNotice.insert({ identity, amount: DISCONNECT_GIFT_AMOUNT, createdAt: ctx.timestamp });
  }
}
