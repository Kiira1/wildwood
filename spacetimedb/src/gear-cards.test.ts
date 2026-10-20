import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { addCard, cardCount, mergeCardData } from "./gear-cards";
import { activeCardsFor } from "./active-cards";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
import { CAMPAIGN_UNLOCK_FIELDS } from "../../shared/equipment-access";
import { IRON_BOW } from "../../shared/items";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

function archer() {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
  return f;
}

describe("the card collection", () => {
  it("counts cards in, and ignores what is not a card", () => {
    const f = archer();
    f.transaction(() => { addCard(f.ctx, f.ctx.sender, "needle_card", 2); addCard(f.ctx, f.ctx.sender, "not_a_card"); });
    expect(cardCount(f.ctx, f.ctx.sender, "needle_card")).toBe(2);
    expect(f.db.playerCard.count()).toBe(1n);
  });

  it("shows each player only their own cards and active cards", () => {
    const f = archer(), other = identity("4");
    f.transaction(() => { addCard(f.ctx, f.ctx.sender, "needle_card"); addCard(f.ctx, other, "brood_card"); });
    f.run(server.activateCard, { cardId: "needle_card", expectedActive: 0 });
    expect((server.myCards as any)(f.ctx).map((row: any) => row.cardId)).toEqual(["needle_card"]);
    expect((server.myActiveCards as any)(f.ctx).map((row: any) => row.hand)).toEqual([["needle_card"]]);
    expect((server.myGearSlots as any)(f.ctx)).toEqual([]);
  });
});

describe("cards through a reset, a prestige and a link", () => {
  function veteran() {
    const f = archer();
    f.patch("playerProgress", { ...Object.fromEntries(CAMPAIGN_UNLOCK_FIELDS.map(field => [field, true])), bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
    f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 1 });
    f.transaction(() => addCard(f.ctx, f.ctx.sender, "needle_card", 3));
    f.run(server.activateCard, { cardId: "needle_card", expectedActive: 0 });
    return f;
  }

  it("keeps cards and the active ones through prestige, as the bag is kept", () => {
    const f = veteran();
    f.run(server.prestigeAccount, {});
    expect(cardCount(f.ctx, f.ctx.sender, "needle_card")).toBe(3);
    expect(activeCardsFor(f.ctx, f.ctx.sender).HAND).toEqual(["needle_card"]);
  });

  it("clears them with the bag on Reset Save", () => {
    const f = veteran();
    f.run(server.resetPlayerProgress, {});
    expect(f.db.playerCard.count()).toBe(0n);
    expect(f.db.playerActiveCard.count()).toBe(0n);
  });

  it("moves a guest's cards and active cards to the account on link, replacing the account's", () => {
    const f = veteran(), account = identity("5");
    f.transaction(() => {
      addCard(f.ctx, account, "brood_card");
      f.db.playerActiveCard.insert({ identity: account, hand: [], head: ["brood_card"], chest: [] });
    });
    f.transaction(() => mergeCardData(f.ctx, f.ctx.sender, account));
    expect(cardCount(f.ctx, account, "needle_card")).toBe(3);
    expect(cardCount(f.ctx, account, "brood_card")).toBe(0);
    expect(activeCardsFor(f.ctx, account)).toEqual({ HAND: ["needle_card"], HEAD: [], CHEST: [] });
    expect([...f.db.playerCard.identity.filter(f.ctx.sender)]).toEqual([]);
    expect(f.db.playerActiveCard.identity.find(f.ctx.sender)).toBeFalsy();
  });
});
