import { table, t, SenderError } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type { ModuleReducerCtx, ModuleViewCtx } from "./index";
import { REBALANCE_MAIL_ID, REBALANCE_MAIL_GEMS, REBALANCE_MAIL_TITLE, REBALANCE_MAIL_BODY } from "../../shared/mailbox";

// One shared letter; per-account state is written only on read or claim.
export const mailboxLetter = table({ name: "mailbox_letter", public: false }, {
  id: t.string().primaryKey(), title: t.string(), body: t.string(), gems: t.u64(),
  createdAt: t.timestamp(), eligibleBefore: t.timestamp(),
});
export const mailboxReceipt = table({ name: "mailbox_receipt", public: false }, {
  key: t.string().primaryKey(), identity: t.identity().index("btree"), letterId: t.string(),
  read: t.bool(), claimed: t.bool(), updatedAt: t.timestamp(),
});
export const mailboxEntry = t.row("MailboxEntry", {
  id: t.string().primaryKey(), title: t.string(), body: t.string(), gems: t.u64(),
  createdAt: t.timestamp(), read: t.bool(), claimed: t.bool(),
});
const receiptKey = (id: string, identity: Identity) => `${id}:${identity.toHexString()}`;

function eligible(ctx: ModuleViewCtx | ModuleReducerCtx, before: bigint) {
  const lifetime = ctx.db.playerLifetime.identity.find(ctx.sender);
  return Boolean(lifetime && lifetime.joinedAt.microsSinceUnixEpoch <= before
    && !ctx.db.virtualPlayer.identity.find(ctx.sender));
}

export function mailboxForPlayer(ctx: ModuleViewCtx) {
  const receipts = new Map([...ctx.db.mailboxReceipt.identity.filter(ctx.sender)].map(row => [row.letterId, row]));
  return [...ctx.db.mailboxLetter.iter()].filter(row => eligible(ctx, row.eligibleBefore.microsSinceUnixEpoch))
    .map(row => ({ id: row.id, title: row.title, body: row.body, gems: row.gems, createdAt: row.createdAt,
      read: receipts.get(row.id)?.read ?? false, claimed: receipts.get(row.id)?.claimed ?? false }));
}

/** Campaign identity, eligibility and reward are immutable; copy can be corrected safely. */
export function publishMailboxLetter(ctx: ModuleReducerCtx, letter: { id: string; title: string; body: string; gems: bigint }) {
  if (!/^[a-z0-9-]{1,80}$/.test(letter.id) || !letter.title.trim() || letter.title.length > 100
    || !letter.body.trim() || letter.body.length > 6000 || letter.gems > 10_000n || letter.gems < 0n) {
    throw new SenderError("Invalid mailbox letter.");
  }
  const existing = ctx.db.mailboxLetter.id.find(letter.id);
  if (existing) {
    if (existing.gems !== letter.gems) {
      throw new SenderError("That mail ID is already in use. Published rewards cannot be changed.");
    }
    if (existing.title !== letter.title || existing.body !== letter.body) {
      ctx.db.mailboxLetter.id.update({ ...existing, title: letter.title, body: letter.body });
    }
    return;
  }
  if ([...ctx.db.mailboxLetter.iter()].length >= 100) throw new SenderError("Mailbox campaign limit reached.");
  ctx.db.mailboxLetter.insert({ ...letter, createdAt: ctx.timestamp, eligibleBefore: ctx.timestamp });
}

export function publishRebalanceMail(ctx: ModuleReducerCtx) {
  publishMailboxLetter(ctx, { id: REBALANCE_MAIL_ID, title: REBALANCE_MAIL_TITLE, body: REBALANCE_MAIL_BODY, gems: REBALANCE_MAIL_GEMS });
}

export function updateMailboxReceipt(ctx: ModuleReducerCtx, id: string, claim: boolean, credit: (amount: bigint, reference: string, title: string) => void) {
  const letter = ctx.db.mailboxLetter.id.find(id);
  if (!letter || !eligible(ctx, letter.eligibleBefore.microsSinceUnixEpoch)) throw new SenderError("Mail unavailable.");
  const key = receiptKey(id, ctx.sender);
  const previous = ctx.db.mailboxReceipt.key.find(key);
  if (claim && letter.gems > 0n && !previous?.claimed) credit(letter.gems, `mailbox:${key}`, letter.title);
  const claimed = Boolean(previous?.claimed || claim && letter.gems > 0n);
  if (previous?.read && previous.claimed === claimed) return;
  const next = { key, identity: ctx.sender, letterId: id, read: true, claimed, updatedAt: ctx.timestamp };
  if (previous) ctx.db.mailboxReceipt.key.update(next);
  else ctx.db.mailboxReceipt.insert(next);
}

export function mergeMailboxReceipts(ctx: ModuleReducerCtx, guest: Identity, account: Identity) {
  for (const row of ctx.db.mailboxReceipt.identity.filter(guest)) {
    const key = receiptKey(row.letterId, account);
    const previous = ctx.db.mailboxReceipt.key.find(key);
    const next = { ...row, key, identity: account, read: row.read || Boolean(previous?.read), claimed: row.claimed || Boolean(previous?.claimed) };
    if (previous) ctx.db.mailboxReceipt.key.update(next);
    else ctx.db.mailboxReceipt.insert(next);
    ctx.db.mailboxReceipt.key.delete(row.key);
  }
}

export function removeMailboxReceipts(ctx: ModuleReducerCtx, identity: Identity) {
  for (const row of ctx.db.mailboxReceipt.identity.filter(identity)) ctx.db.mailboxReceipt.key.delete(row.key);
}
