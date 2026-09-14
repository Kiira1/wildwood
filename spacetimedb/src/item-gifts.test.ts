import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { deliverAlphaTesterGifts, mergeItemGifts } from "./item-gifts";
import { ALPHA_TESTER_GIFT_CAMPAIGN, ALPHA_TESTER_GIFT_ITEM, ALPHA_TESTER_REGISTRATION_START, ALPHA_TESTER_REGISTRATION_END } from "../../shared/item-gifts";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));
function fixture(type = "guest", firstSeen = ALPHA_TESTER_REGISTRATION_START) {
  const f = crystalFixture();
  f.seed("playerAccessAudit", { identity: f.ctx.sender, accountType: type, firstSeenAt: new Timestamp(firstSeen) });
  const key = `${ALPHA_TESTER_GIFT_CAMPAIGN}:${f.ctx.sender.toHexString()}`;
  const deliver = () => f.transaction(() => deliverAlphaTesterGifts(f.ctx as never, [f.ctx.sender]));
  return { ...f, key, deliver };
}
describe("developer item gifts", () => {
  it.each(["account", "guest"])("delivers %s gifts once, keeps them pending, and claims the cosmetic without replacing gear", type => {
    const f = fixture(type), before = f.db.playerProgress.identity.find(f.ctx.sender);
    f.deliver(); f.deliver();
    expect(f.db.playerItemGift.count()).toBe(1n);
    expect(server.myItemGifts(f.ctx as never)).toHaveLength(1);
    const peer = identity("2");
    expect(server.myItemGifts({ ...f.ctx, sender: peer } as never)).toEqual([]);
    f.run(server.claimDeveloperItemGift, { key: f.key });
    f.run(server.claimDeveloperItemGift, { key: f.key }); f.deliver();
    const progress = f.db.playerProgress.identity.find(f.ctx.sender);
    expect(JSON.parse(progress.inventoryJson).filter((id: string) => id === ALPHA_TESTER_GIFT_ITEM)).toHaveLength(1);
    expect(progress.equippedHead).toBe(before.equippedHead);
    expect(progress.maxHp).toBe(before.maxHp);
    expect(server.myItemGifts(f.ctx as never)).toEqual([]);
    expect(f.db.playerItemGift.key.find(f.key).claimed).toBe(true);
  });
  it("rejects public delivery, ineligible dates, virtual players, and another player's claim", () => {
    const f = fixture();
    expect(() => f.run(server.devDeliverAlphaTesterGifts, { recipients: [f.ctx.sender] })).toThrow(/Developer/);
    for (const date of [ALPHA_TESTER_REGISTRATION_START - 1n, ALPHA_TESTER_REGISTRATION_END]) {
      const old = fixture("guest", date); expect(old.deliver).toThrow(/September 13/);
    }
    f.deliver();
    expect(() => server.claimDeveloperItemGift({ ...f.ctx, sender: identity("2") } as never, { key: f.key })).toThrow();
    f.seed("virtualPlayer", { identity: f.ctx.sender }); expect(f.deliver).toThrow(/September 13/);
  });
  it("carries an unclaimed guest gift to the linked account and preserves claimed receipts", () => {
    const f = fixture(), account = identity("2");
    f.deliver();
    f.transaction(() => mergeItemGifts(f.ctx as never, f.ctx.sender, account));
    const accountKey = `${ALPHA_TESTER_GIFT_CAMPAIGN}:${account.toHexString()}`;
    expect(f.db.playerItemGift.key.find(f.key)).toBeNull();
    expect(f.db.playerItemGift.key.find(accountKey).claimed).toBe(false);
    f.db.playerItemGift.key.update({ ...f.db.playerItemGift.key.find(accountKey), claimed: true });
    f.deliver();
    f.transaction(() => mergeItemGifts(f.ctx as never, f.ctx.sender, account));
    expect(f.db.playerItemGift.key.find(accountKey).claimed).toBe(true);
  });
});
