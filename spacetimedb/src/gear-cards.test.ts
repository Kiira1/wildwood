import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { bowSkillKey } from "./bow-skills";
import {
  addCard, cardCount, gearSlotsFor, mergeCardData, normalizeGearSlots, setGearSlots, takeCard,
} from "./gear-cards";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
import { CAMPAIGN_UNLOCK_FIELDS } from "../../shared/equipment-access";
import { IRON_BOW, SAMURAI_HAT } from "../../shared/items";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

// Slots and the cards in them belong to one copy of an item and follow it, as a refine does (gear-cards.ts).
type Fixture = ReturnType<typeof crystalFixture>;

function archer() {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW, SAMURAI_HAT]), equippedRightHand: IRON_BOW });
  f.seed("playerBowSkill", { key: bowSkillKey(f.ctx.sender, IRON_BOW), identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 2, ricochet: 0, piercingShot: 0 });
  return f;
}
const keepCopy = (f: Fixture, itemId = IRON_BOW) =>
  f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId, arrowStorm: 0, ricochet: 3, piercingShot: 0, acquiredAt: f.ctx.timestamp });
const slots = (f: Fixture, itemId = IRON_BOW, copyId = 0n) => gearSlotsFor(f.ctx, f.ctx.sender, itemId, copyId);
const set = (f: Fixture, value: { slots: number; cards: string[] }, itemId = IRON_BOW, copyId = 0n) =>
  f.transaction(() => setGearSlots(f.ctx, f.ctx.sender, itemId, copyId, value));
const inventory = (f: Fixture): string[] => JSON.parse(progressOf(f, f.ctx.sender).inventoryJson);

describe("gear slots", () => {
  it("gives gear with no row one empty slot, and stores anything else", () => {
    const f = archer();
    expect(slots(f)).toEqual({ slots: 1, cards: [] });
    set(f, { slots: 0, cards: [] });
    expect(slots(f)).toEqual({ slots: 0, cards: [] });
    expect(f.db.playerGearSlots.count()).toBe(1n);
    set(f, { slots: 3, cards: ["needle_card", "needle_card"] });
    expect(slots(f)).toEqual({ slots: 3, cards: ["needle_card", "needle_card"] });
    // One empty slot is what no row means: the row goes.
    set(f, { slots: 1, cards: [] });
    expect(f.db.playerGearSlots.count()).toBe(0n);
  });

  it("keeps slots between 0 and 4 and only real cards, no more than the slots", () => {
    expect(normalizeGearSlots({ slots: 9, cards: [] }).slots).toBe(4);
    expect(normalizeGearSlots({ slots: -2, cards: [] }).slots).toBe(0);
    expect(normalizeGearSlots({ slots: 2, cards: ["needle_card", "not_a_card", "mossback_card", "spitter_card"] }))
      .toEqual({ slots: 2, cards: ["needle_card", "mossback_card"] });
    expect(normalizeGearSlots(null)).toEqual({ slots: 1, cards: [] });
  });

  it("swaps with the first copy when a kept copy is chosen, bow or not", () => {
    const f = archer();
    const bow = keepCopy(f), hat = keepCopy(f, SAMURAI_HAT);
    set(f, { slots: 4, cards: ["needle_card"] });
    set(f, { slots: 2, cards: [] }, IRON_BOW, bow.id);
    set(f, { slots: 3, cards: ["brood_card"] }, SAMURAI_HAT, hat.id);
    f.run(server.selectEquipmentCopy, { copyId: bow.id });
    expect([slots(f), slots(f, IRON_BOW, bow.id)]).toEqual([{ slots: 2, cards: [] }, { slots: 4, cards: ["needle_card"] }]);
    f.run(server.selectEquipmentCopy, { copyId: hat.id });
    expect([slots(f, SAMURAI_HAT), slots(f, SAMURAI_HAT, hat.id)]).toEqual([{ slots: 3, cards: ["brood_card"] }, { slots: 1, cards: [] }]);
  });

  it("goes with a destroyed copy, and the kept copy taking over the first brings its own", () => {
    const f = archer();
    const doomed = keepCopy(f);
    set(f, { slots: 4, cards: ["needle_card"] }, IRON_BOW, doomed.id);
    f.run(server.destroyEquipmentCopy, { itemId: IRON_BOW, copyId: doomed.id });
    expect(f.db.playerCopySlots.copyId.find(doomed.id)).toBeFalsy();

    const bow = keepCopy(f);
    set(f, { slots: 3, cards: ["spitter_card"] });
    set(f, { slots: 2, cards: ["needle_card"] }, IRON_BOW, bow.id);
    f.run(server.destroyEquipment, { itemId: IRON_BOW });
    expect(slots(f)).toEqual({ slots: 2, cards: ["needle_card"] });
    expect(f.db.playerCopySlots.copyId.find(bow.id)).toBeFalsy();
    // The last copy destroyed: the item, its slots and its cards are gone, and nothing comes back with it.
    f.run(server.destroyEquipment, { itemId: IRON_BOW });
    expect(inventory(f)).not.toContain(IRON_BOW);
    expect(f.db.playerGearSlots.count()).toBe(0n);
  });
});

describe("the card collection", () => {
  it("counts cards in and out, never below none, and ignores what is not a card", () => {
    const f = archer();
    f.transaction(() => { addCard(f.ctx, f.ctx.sender, "needle_card", 2); addCard(f.ctx, f.ctx.sender, "not_a_card"); });
    expect(cardCount(f.ctx, f.ctx.sender, "needle_card")).toBe(2);
    expect(f.db.playerCard.count()).toBe(1n);
    expect(f.transaction(() => takeCard(f.ctx, f.ctx.sender, "needle_card"))).toBe(true);
    expect(f.transaction(() => takeCard(f.ctx, f.ctx.sender, "needle_card"))).toBe(true);
    expect(f.transaction(() => takeCard(f.ctx, f.ctx.sender, "needle_card"))).toBe(false);
    expect(f.db.playerCard.count()).toBe(0n);
  });

  it("shows each player only their own cards and slots", () => {
    const f = archer(), other = identity("4");
    f.transaction(() => { addCard(f.ctx, f.ctx.sender, "needle_card"); addCard(f.ctx, other, "brood_card"); });
    set(f, { slots: 3, cards: [] });
    f.transaction(() => setGearSlots(f.ctx, other, IRON_BOW, 0n, { slots: 4, cards: [] }));
    expect((server.myCards as any)(f.ctx).map((row: any) => row.cardId)).toEqual(["needle_card"]);
    expect((server.myGearSlots as any)(f.ctx).map((row: any) => row.slots)).toEqual([3]);
    expect((server.myCopySlots as any)(f.ctx)).toEqual([]);
  });
});

describe("cards through a reset, a prestige and a link", () => {
  function veteran() {
    const f = archer();
    f.patch("playerProgress", { ...Object.fromEntries(CAMPAIGN_UNLOCK_FIELDS.map(field => [field, true])), bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
    f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 1 });
    f.transaction(() => addCard(f.ctx, f.ctx.sender, "needle_card", 3));
    set(f, { slots: 4, cards: ["needle_card"] });
    return f;
  }

  it("keeps cards and slots through prestige, as the bag is kept", () => {
    const f = veteran();
    f.run(server.prestigeAccount, {});
    expect(cardCount(f.ctx, f.ctx.sender, "needle_card")).toBe(3);
    expect(slots(f)).toEqual({ slots: 4, cards: ["needle_card"] });
  });

  it("clears them with the bag on Reset Save", () => {
    const f = veteran();
    f.run(server.resetPlayerProgress, {});
    expect(f.db.playerCard.count()).toBe(0n);
    expect(f.db.playerGearSlots.count()).toBe(0n);
  });

  it("moves a guest's cards and slots to the account on link, replacing the account's", () => {
    const f = veteran(), account = identity("5");
    f.transaction(() => { addCard(f.ctx, account, "brood_card"); setGearSlots(f.ctx, account, SAMURAI_HAT, 0n, { slots: 2, cards: [] }); });
    f.transaction(() => mergeCardData(f.ctx, f.ctx.sender, account));
    expect(cardCount(f.ctx, account, "needle_card")).toBe(3);
    expect(cardCount(f.ctx, account, "brood_card")).toBe(0);
    expect(gearSlotsFor(f.ctx, account, IRON_BOW)).toEqual({ slots: 4, cards: ["needle_card"] });
    expect(gearSlotsFor(f.ctx, account, SAMURAI_HAT)).toEqual({ slots: 1, cards: [] });
    expect([...f.db.playerCard.identity.filter(f.ctx.sender)]).toEqual([]);
  });
});
