import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { publishRebalanceMail, mergeMailboxReceipts, publishMailboxLetter, MAIL_LIFETIME_MICROS } from "./mailbox";
import { deliverEquipmentMail } from "./mailbox-equipment";
import { sendPersonalMail } from "./dev-review-mail";
import { REBALANCE_MAIL_ID } from "../../shared/mailbox";
import { GEAR_MAIL_ID } from "../../shared/mailbox-equipment";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

function fixture() {
  const f = crystalFixture();
  f.seed("playerLifetime", { identity: f.ctx.sender, joinedAt: new Timestamp(1n), playedMicros: 0n, sessionStartedAt: new Timestamp(0n), enemyKills: 0n, deathCount: 0n });
  f.transaction(() => publishRebalanceMail(f.ctx as never));
  return f;
}
describe("mailbox", () => {
  it("delivers one shared letter without crediting or writing per-player state until opened", () => {
    const f = fixture();
    f.transaction(() => publishRebalanceMail(f.ctx as never));
    expect(f.db.mailboxLetter.count()).toBe(1n);
    expect(f.db.mailboxReceipt.count()).toBe(0n);
    expect(server.myMailboxV2(f.ctx as never)[0]).toMatchObject({ gems: 75n, read: false, claimed: false });
    f.run(server.readMailboxLetter, { id: REBALANCE_MAIL_ID });
    expect(server.myMailboxV2(f.ctx as never)[0]).toMatchObject({ read: true, claimed: false });
    expect(f.db.gemTransaction.count()).toBe(0n);
  });
  it("credits 75 gems once across repeated claims and keeps the claimed letter", () => {
    const f = fixture();
    f.run(server.claimMailboxGift, { id: REBALANCE_MAIL_ID });
    f.run(server.claimMailboxGift, { id: REBALANCE_MAIL_ID });
    expect(f.db.playerGemWallet.identity.find(f.ctx.sender).balance).toBe(75n);
    expect(f.db.gemTransaction.count()).toBe(1n);
    expect(server.myMailboxV2(f.ctx as never)[0]).toMatchObject({ read: true, claimed: true });
  });
  it("excludes new/virtual identities and rejects forged campaigns and non-developer delivery", () => {
    const f = fixture();
    expect(() => f.run(server.claimMailboxGift, { id: "made-up" })).toThrow(/unavailable/);
    expect(() => f.run(server.devPublishMailboxLetter, { id: "forged", title: "x", body: "x", gems: 999n })).toThrow(/Developer/);
    f.patch("playerLifetime", { joinedAt: new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + 1n) });
    expect(server.myMailboxV2(f.ctx as never)).toEqual([]);
    expect(() => f.run(server.claimMailboxGift, { id: REBALANCE_MAIL_ID })).toThrow(/unavailable/);
    f.patch("playerLifetime", { joinedAt: new Timestamp(1n) });
    f.seed("virtualPlayer", { identity: f.ctx.sender });
    expect(server.myMailboxV2(f.ctx as never)).toEqual([]);
  });
  it("preserves a claimed guest receipt when registering so it cannot pay again", () => {
    const f = fixture(), account = identity("2");
    f.run(server.claimMailboxGift, { id: REBALANCE_MAIL_ID });
    f.transaction(() => mergeMailboxReceipts(f.ctx as never, f.ctx.sender, account));
    f.seed("playerLifetime", { identity: account, joinedAt: new Timestamp(1n) });
    expect(server.myMailboxV2({ ...f.ctx, sender: account } as never)[0].claimed).toBe(true);
    expect([...f.db.mailboxReceipt.identity.filter(f.ctx.sender)]).toEqual([]);
    expect([...f.db.mailboxReceipt.identity.filter(account)]).toHaveLength(1);
  });
  it("edits wording without resetting claims, reward, dates or eligibility", () => {
    const f = fixture();
    f.run(server.claimMailboxGift, { id: REBALANCE_MAIL_ID });
    const before = f.db.mailboxLetter.id.find(REBALANCE_MAIL_ID);
    f.transaction(() => publishMailboxLetter(f.ctx as never, { ...before, title: "Quick update", body: "Thanks everyone -- here's what changed." }));
    expect(f.db.mailboxLetter.id.find(REBALANCE_MAIL_ID)).toMatchObject({ ...before, title: "Quick update", body: "Thanks everyone -- here's what changed." });
    f.run(server.claimMailboxGift, { id: REBALANCE_MAIL_ID });
    expect(f.db.playerGemWallet.identity.find(f.ctx.sender).balance).toBe(75n);
    expect(f.db.gemTransaction.count()).toBe(1n);
    expect(server.myMailboxV2(f.ctx as never)[0].claimed).toBe(true);
  });
  it("rejects changing an already-published gift amount", () => {
    const f = fixture(), letter = f.db.mailboxLetter.id.find(REBALANCE_MAIL_ID);
    expect(() => f.transaction(() => publishMailboxLetter(f.ctx as never, { ...letter, gems: 500n }))).toThrow(/already in use/);
  });
});

describe("mail expiry", () => {
  const DAY = 24n * 60n * 60n * 1_000_000n;
  const ids = (f: ReturnType<typeof fixture>) => server.myMailboxV2(f.ctx as never).map((row: any) => row.id).sort();

  it("lasts a week", () => {
    expect(MAIL_LIFETIME_MICROS).toBe(7n * DAY);
  });

  it("clears every letter a week after it was sent, claimed or not, with its receipts and gifts, and keeps younger ones", () => {
    const f = fixture(), sent = f.ctx.timestamp.microsSinceUnixEpoch;
    f.run(server.claimMailboxGift, { id: REBALANCE_MAIL_ID });
    f.transaction(() => {
      publishMailboxLetter(f.ctx as never, { id: GEAR_MAIL_ID, title: "Gear for your map", body: "Gear.", gems: 0n });
      deliverEquipmentMail(f.ctx as never, [f.ctx.sender]);
      sendPersonalMail(f.ctx as never, { key: "dev-reply-old", identity: f.ctx.sender, title: "Your report", body: "Thanks." });
    });
    f.ctx.timestamp = new Timestamp(sent + DAY);
    f.transaction(() => sendPersonalMail(f.ctx as never, { key: "dev-reply-new", identity: f.ctx.sender, title: "Your report", body: "Thanks." }));
    const everything = [GEAR_MAIL_ID, REBALANCE_MAIL_ID, "dev-reply-new", "dev-reply-old"].sort();
    expect(ids(f)).toEqual(everything);

    // Six days on, the maintenance sweep's hourly turn leaves everything.
    f.ctx.timestamp = new Timestamp(sent + 6n * DAY);
    f.run(server.runMaintenanceSweep);
    expect(ids(f)).toEqual(everything);

    // A week on, what was sent then is gone for everyone; the letter sent a day later stays.
    f.ctx.timestamp = new Timestamp(sent + 7n * DAY);
    f.run(server.runMaintenanceSweep);
    expect(ids(f)).toEqual(["dev-reply-new"]);
    expect(f.db.mailboxLetter.count()).toBe(0n);
    expect(f.db.mailboxReceipt.count()).toBe(0n);
    expect(f.db.mailboxEquipment.count()).toBe(0n);
    expect(() => f.run(server.claimMailboxGift, { id: GEAR_MAIL_ID })).toThrow(/unavailable/);
    // Gems already claimed stay paid, and the same letter sent again cannot pay them twice.
    f.transaction(() => publishRebalanceMail(f.ctx as never));
    f.run(server.claimMailboxGift, { id: REBALANCE_MAIL_ID });
    expect(f.db.playerGemWallet.identity.find(f.ctx.sender).balance).toBe(75n);
    expect(f.db.gemTransaction.count()).toBe(1n);

    f.ctx.timestamp = new Timestamp(sent + 8n * DAY);
    f.run(server.runMaintenanceSweep);
    expect(ids(f)).toEqual([REBALANCE_MAIL_ID]);
  });
});

describe("mailbox join date", () => {
  it("reads the join date from its own row, so kill reports never re-run the view", () => {
    const f = fixture();
    f.seed("playerJoinDate", { identity: f.ctx.sender, joinedAt: new Timestamp(1n) });
    const lifetimeReads = vi.spyOn(f.db.playerLifetime.identity, "find");
    expect(server.myMailboxV2(f.ctx as never)).toHaveLength(1);
    expect(lifetimeReads).not.toHaveBeenCalled();
    lifetimeReads.mockRestore();
  });
  it("backfills every existing join date once", () => {
    const f = fixture();
    f.seed("moduleMigrationState", { id: 0, version: 41 });
    f.ctx.connectionId = null;
    f.run(server.onConnect);
    expect(f.db.playerJoinDate.identity.find(f.ctx.sender)?.joinedAt.microsSinceUnixEpoch).toBe(1n);
  });
});
