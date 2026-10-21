import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { addCard, cardCount } from "./gear-cards";
import { activateCardsFromGear, activeCardIdsFor, activeCardSlotsFor, activeCardTotalsFor, activeCardsFor } from "./active-cards";
import { writePrestigePerkRanks, storedPrestigePerkRanks } from "./prestige";
import { mergeLinkedPrestige } from "./prestige-transfer";
import { IRON_BOW } from "../../shared/items";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;

/** A prestiged archer with four Needle cards, a Spitter card and a Brood card, and perk points to spend. */
function collector(points = 12) {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
  f.seed("playerPrestige", { identity: f.ctx.sender, level: 3, perkPoints: points, peakPower: 0, prestigedAt: f.ctx.timestamp });
  f.transaction(() => {
    addCard(f.ctx, f.ctx.sender, "needle_card", 4);
    addCard(f.ctx, f.ctx.sender, "spitter_card", 1);
    addCard(f.ctx, f.ctx.sender, "brood_card", 1);
  });
  const active = () => activeCardsFor(f.ctx, f.ctx.sender);
  const activate = (cardId: string, expectedActive = active()[cardId === "brood_card" ? "HEAD" : "HAND"].filter(id => id === cardId).length) =>
    f.run(server.activateCard, { cardId, expectedActive });
  const spend = (perk: string) => f.run(server.spendPrestigePerkPoint, { perk });
  return { ...f, active, activate, spend, inPlay: () => activeCardIdsFor(f.ctx, f.ctx.sender), slots: () => activeCardSlotsFor(f.ctx, f.ctx.sender) };
}

describe("active card slots", () => {
  it("start at one of each type, and each Card Slots rank opens one more, up to four", () => {
    const f = collector();
    expect(f.slots()).toEqual({ HAND: 1, HEAD: 1, CHEST: 1 });
    for (const expected of [2, 3, 4]) {
      f.spend("weaponCards");
      expect(f.slots().HAND).toBe(expected);
    }
    expect(() => f.spend("weaponCards")).toThrow("highest rank");
    f.spend("helmetCards");
    f.spend("armorCards");
    expect(f.slots()).toEqual({ HAND: 4, HEAD: 2, CHEST: 2 });
    expect(f.db.playerPrestigeCardPerk.identity.find(f.ctx.sender)).toMatchObject({ weaponCards: 3, helmetCards: 1, armorCards: 1 });
    expect(f.db.playerPrestige.identity.find(f.ctx.sender).perkPoints).toBe(7);
  });
});

describe("activating cards", () => {
  it("fills one slot per copy owned, never more copies than owned, and only free slots of the card's type", () => {
    const f = collector();
    f.activate("needle_card");
    expect(f.active().HAND).toEqual(["needle_card"]);
    expect(() => f.activate("spitter_card")).toThrow("full");
    f.activate("brood_card");
    expect(f.active().HEAD).toEqual(["brood_card"]);
    expect(() => f.activate("brood_card")).toThrow("already active");
    for (let rank = 0; rank < 3; rank++) f.spend("weaponCards");
    f.activate("needle_card"); f.activate("needle_card"); f.activate("needle_card");
    expect(f.active().HAND).toEqual(["needle_card", "needle_card", "needle_card", "needle_card"]);
    // Activating takes nothing from the collection.
    expect(cardCount(f.ctx, f.ctx.sender, "needle_card")).toBe(4);
    expect(activeCardTotalsFor(f.ctx, f.ctx.sender).sum.doubleStrike).toBe(4);
  });

  it("refuses a card not owned, a stale tap and an unknown card, changing nothing", () => {
    const f = collector();
    expect(() => f.activate("dragon_card", 0)).toThrow("no Dragon");
    f.activate("needle_card");
    // A retried tap still says none were active: refused, so one tap switches on one copy.
    expect(() => f.activate("needle_card", 0)).toThrow("changed");
    expect(() => f.activate("nope", 0)).toThrow("does not exist");
    expect(f.active().HAND).toEqual(["needle_card"]);
  });

  it("switches a card off by its slot, keeping it owned, and refuses a stale slot", () => {
    const f = collector();
    f.activate("needle_card");
    expect(() => f.run(server.deactivateCard, { cardType: "HAND", index: 0, cardId: "spitter_card" })).toThrow("changed");
    f.run(server.deactivateCard, { cardType: "HAND", index: 0, cardId: "needle_card" });
    expect(f.active().HAND).toEqual([]);
    expect(f.db.playerActiveCard.count()).toBe(0n);
    expect(cardCount(f.ctx, f.ctx.sender, "needle_card")).toBe(4);
  });

  it("changes power and the attack cap when cards switch on", () => {
    const f = collector();
    f.transaction(() => addCard(f.ctx, f.ctx.sender, "ion_needle_card"));
    const before = f.db.player.identity.find(f.ctx.sender).powerLevel;
    f.run(server.activateCard, { cardId: "ion_needle_card", expectedActive: 0 });
    expect(f.db.playerCardAttackCap.identity.find(f.ctx.sender)?.raise).toBeCloseTo(.1, 9);
    expect(f.db.player.identity.find(f.ctx.sender).powerLevel).not.toBe(before);
  });
});

describe("perks out of play", () => {
  function fullHand(f: ReturnType<typeof collector>) {
    for (let rank = 0; rank < 3; rank++) f.spend("weaponCards");
    for (let copy = 0; copy < 4; copy++) f.activate("needle_card");
  }

  it("leaves one slot of each type during an Aggro run; the other choices wait and come back", () => {
    const f = collector();
    fullHand(f);
    f.seed("playerAggroChallenge", { identity: f.ctx.sender, active: true, completed: 0 });
    expect(f.slots()).toEqual({ HAND: 1, HEAD: 1, CHEST: 1 });
    expect(f.inPlay()).toEqual(["needle_card"]);
    expect(f.active().HAND).toHaveLength(4);
    expect(() => f.activate("needle_card", 0)).toThrow();
    f.patch("playerAggroChallenge", { active: false });
    expect(f.inPlay()).toHaveLength(4);
  });

  it("keeps the choices through a respec, with only the first in play until the ranks are spent again", () => {
    const f = collector();
    fullHand(f);
    f.run(server.respecPrestigePerks, {});
    expect(storedPrestigePerkRanks(f.ctx, f.ctx.sender).weaponCards).toBe(0);
    expect(f.inPlay()).toEqual(["needle_card"]);
    expect(f.active().HAND).toHaveLength(4);
    f.spend("weaponCards");
    expect(f.inPlay()).toEqual(["needle_card", "needle_card"]);
  });

  it("goes back to one slot when the perk is switched off", () => {
    const f = collector();
    fullHand(f);
    f.seed("playerBonusToggle", { identity: f.ctx.sender, off: "prestige.weaponCards" });
    expect(f.slots().HAND).toBe(1);
    expect(f.inPlay()).toEqual(["needle_card"]);
  });

  it("merges a guest's card slot ranks into the account's, capped at three", () => {
    const f = collector(), account = identity("7");
    f.transaction(() => {
      writePrestigePerkRanks(f.ctx, account, { ...storedPrestigePerkRanks(f.ctx, account), weaponCards: 2 });
      writePrestigePerkRanks(f.ctx, f.ctx.sender, { ...storedPrestigePerkRanks(f.ctx, f.ctx.sender), weaponCards: 2, armorCards: 1 });
    });
    f.transaction(() => mergeLinkedPrestige(f.ctx, f.ctx.sender, account));
    expect(storedPrestigePerkRanks(f.ctx, account)).toMatchObject({ weaponCards: 3, helmetCards: 0, armorCards: 1 });
    expect(f.db.playerPrestigeCardPerk.identity.find(f.ctx.sender)).toBeFalsy();
    // The rank past the cap comes back as a point.
    expect(f.db.playerPrestige.identity.find(account).perkPoints).toBe(13);
  });
});

describe("migration 59: gear stops holding cards", () => {
  function slotted(f: Fixture, who: any, itemId: string, cards: string[], copyId = 0n) {
    f.transaction(() => copyId
      ? f.db.playerCopySlots.insert({ copyId, identity: who, itemId, slots: 4, cards })
      : f.db.playerGearSlots.insert({ key: `${who.toHexString()}:${itemId}`, identity: who, itemId, slots: 4, cards }));
  }

  it("activates the strongest card in each worn item, one a type, and returns every slotted card to the collection", () => {
    const f = crystalFixture(), other = identity("8");
    f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW, "sky_bow", "forest_cap", "wooden_armor"]),
      equippedRightHand: IRON_BOW, equippedHead: "forest_cap", equippedChest: "wooden_armor" });
    f.progress(other, { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: "" });
    f.transaction(() => addCard(f.ctx, f.ctx.sender, "needle_card", 2));
    // Worn bow: a regular, a boss and an elite card; the boss card is the strongest.
    slotted(f, f.ctx.sender, IRON_BOW, ["needle_card", "dragon_card", "dread_warden_card", "needle_card"]);
    slotted(f, f.ctx.sender, "forest_cap", ["brood_card", "striker_card"]);
    slotted(f, f.ctx.sender, "wooden_armor", []);
    // Not worn: its cards come back, none become active.
    slotted(f, f.ctx.sender, "sky_bow", ["spitter_card"]);
    slotted(f, f.ctx.sender, IRON_BOW, ["cindermaw_card"], 99n);
    slotted(f, other, IRON_BOW, ["needle_card"]);
    const before = [...f.db.playerCard.iter()].reduce((sum, row) => sum + row.count, 0);
    f.transaction(() => activateCardsFromGear(f.ctx));
    expect(activeCardsFor(f.ctx, f.ctx.sender)).toEqual({ HAND: ["dragon_card"], HEAD: ["brood_card"], CHEST: [] });
    expect(activeCardsFor(f.ctx, other)).toEqual({ HAND: [], HEAD: [], CHEST: [] });
    const count = (cardId: string, who = f.ctx.sender) => cardCount(f.ctx, who, cardId);
    expect([count("needle_card"), count("dragon_card"), count("dread_warden_card"), count("brood_card"), count("striker_card"),
      count("spitter_card"), count("cindermaw_card"), count("needle_card", other)]).toEqual([4, 1, 1, 1, 1, 1, 1, 1]);
    // Nine slotted cards, all in the collection now; none lost, none made.
    expect([...f.db.playerCard.iter()].reduce((sum, row) => sum + row.count, 0)).toBe(before + 9);
    expect([f.db.playerGearSlots.count(), f.db.playerCopySlots.count()]).toEqual([0n, 0n]);
    // Every active copy is owned.
    expect(activeCardIdsFor(f.ctx, f.ctx.sender).every(cardId => count(cardId) >= 1)).toBe(true);
  });

  it("runs once with the module migrations and then leaves the cards alone", () => {
    const f = crystalFixture();
    f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
    slotted(f, f.ctx.sender, IRON_BOW, ["needle_card"]);
    f.transaction(() => { activateCardsFromGear(f.ctx); activateCardsFromGear(f.ctx); });
    expect(cardCount(f.ctx, f.ctx.sender, "needle_card")).toBe(1);
    expect(activeCardsFor(f.ctx, f.ctx.sender).HAND).toEqual(["needle_card"]);
  });
});
