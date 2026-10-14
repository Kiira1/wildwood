import { describe, expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { TOWN_FEET_OFFSET, TOWN_SMITH_POSITION } from "../../shared/town";
import { addCard, cardCount, gearSlotsFor, setGearSlots } from "./gear-cards";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

/** Beside the Smith, wearing an Ion Bow with two slots, holding a Sky Bow and an Ion Helmet, with cards. */
function atTheSmith() {
  const f = crystalFixture();
  f.patch("player", { mapId: "town", x: TOWN_SMITH_POSITION.x, y: TOWN_SMITH_POSITION.y - TOWN_FEET_OFFSET });
  f.patch("playerProgress", { inventoryJson: JSON.stringify(["ion_bow", "sky_bow", "ion_helmet"]), equippedRightHand: "ion_bow" });
  f.transaction(() => {
    setGearSlots(f.ctx, f.ctx.sender, "ion_bow", 0n, { slots: 2, cards: [] });
    addCard(f.ctx, f.ctx.sender, "needle_card", 3);
    addCard(f.ctx, f.ctx.sender, "brood_card", 1);
  });
  const slot = (cardId = "needle_card", itemId = "ion_bow", copyId = 0n,
    expectedCards = gearSlotsFor(f.ctx, f.ctx.sender, itemId, copyId).cards.length) =>
    f.run(server.slotCard, { itemId, copyId, cardId, expectedCards });
  return { ...f, slot, slots: (itemId = "ion_bow", copyId = 0n) => gearSlotsFor(f.ctx, f.ctx.sender, itemId, copyId),
    cards: (cardId = "needle_card") => cardCount(f.ctx, f.ctx.sender, cardId) };
}

describe("slotting a card", () => {
  it("puts a held card into a free slot, for good, and spends it", () => {
    const f = atTheSmith();
    f.slot();
    f.slot();
    expect(f.slots()).toEqual({ slots: 2, cards: ["needle_card", "needle_card"] });
    expect(f.cards()).toBe(1);
    expect(() => f.slot()).toThrow("Every slot in that item is full.");
    expect(f.cards()).toBe(1);
  });

  it("is only done at the Smith", () => {
    const f = atTheSmith();
    f.patch("player", { mapId: "town", x: TOWN_SMITH_POSITION.x + 400, y: TOWN_SMITH_POSITION.y - TOWN_FEET_OFFSET });
    expect(() => f.slot()).toThrow("Talk to the Smith first.");
    f.patch("player", { mapId: "crystal_hollows", x: TOWN_SMITH_POSITION.x, y: TOWN_SMITH_POSITION.y - TOWN_FEET_OFFSET });
    expect(() => f.slot()).toThrow("Talk to the Smith first.");
    expect(f.cards()).toBe(3);
  });

  it("needs a held card that fits the gear, and gear the player holds that takes cards", () => {
    const f = atTheSmith();
    expect(() => f.slot("brood_card")).toThrow("A Brood Card goes in a helmet.");
    expect(() => f.slot("spitter_card")).toThrow("You have no Spitter Card.");
    expect(() => f.slot("not_a_card")).toThrow("That card does not exist.");
    expect(() => f.slot("needle_card", "starter_stone")).toThrow("That item takes no cards.");
    expect(() => f.slot("needle_card", "neon_bow")).toThrow("That item is not in your inventory.");
    // The Ion Helmet has its one owned-gear slot: a helmet card goes in.
    f.slot("brood_card", "ion_helmet");
    expect(f.slots("ion_helmet")).toEqual({ slots: 1, cards: ["brood_card"] });
    expect(f.cards("brood_card")).toBe(0);
  });

  it("refuses a stale window and gear with no slots, spending nothing", () => {
    const f = atTheSmith();
    expect(() => f.slot("needle_card", "ion_bow", 0n, 1)).toThrow("That item's cards changed.");
    f.transaction(() => setGearSlots(f.ctx, f.ctx.sender, "sky_bow", 0n, { slots: 0, cards: [] }));
    expect(() => f.slot("needle_card", "sky_bow")).toThrow("That item has no slots.");
    expect(f.cards()).toBe(3);
  });

  it("spends only one card when a timed-out request is retried with the same observed count", () => {
    const f = atTheSmith();
    f.slot("needle_card", "ion_bow", 0n, 0);
    expect(() => f.slot("needle_card", "ion_bow", 0n, 0)).toThrow("That item's cards changed.");
    expect(f.slots()).toEqual({ slots: 2, cards: ["needle_card"] });
    expect(f.cards()).toBe(2);
  });

  it("slots a kept copy's own slots, not the first copy's", () => {
    const f = atTheSmith();
    const copy = f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: "ion_bow", arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp });
    f.slot("needle_card", "ion_bow", copy.id);
    expect(f.slots("ion_bow", copy.id)).toEqual({ slots: 1, cards: ["needle_card"] });
    expect(f.slots()).toEqual({ slots: 2, cards: [] });
    expect(() => f.slot("needle_card", "sky_bow", copy.id)).toThrow("That copy is not in your inventory.");
  });
});
