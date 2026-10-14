import { describe, expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { addCard, cardCount, gearSlotsFor, setGearSlots } from "./gear-cards";
import { parseBuildGear } from "../../shared/builds";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

/** Wearing an Ion Bow with two slots holding Needle cards, with a Sky Bow in the bag and one more Needle card held. */
function builder() {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify(["ion_bow", "sky_bow"]), equippedRightHand: "ion_bow" });
  f.transaction(() => {
    setGearSlots(f.ctx, f.ctx.sender, "ion_bow", 0n, { slots: 2, cards: ["needle_card", "needle_card"] });
    setGearSlots(f.ctx, f.ctx.sender, "sky_bow", 0n, { slots: 2, cards: [] });
    addCard(f.ctx, f.ctx.sender, "needle_card", 1);
  });
  const slots = (itemId: string) => gearSlotsFor(f.ctx, f.ctx.sender, itemId).cards;
  return { ...f, slots, held: () => cardCount(f.ctx, f.ctx.sender, "needle_card") };
}

describe("builds", () => {
  it("saves the worn gear and each worn item's cards", () => {
    const f = builder();
    f.run(server.saveBuild, { slot: 1 });
    const row = f.db.playerBuild.key.find(`${f.ctx.sender.toHexString()}:1`);
    expect(parseBuildGear(row.gearJson).HAND).toBe("ion_bow");
    expect(JSON.parse(row.cardsJson)).toEqual({ ion_bow: ["needle_card", "needle_card"] });
    expect(() => f.run(server.saveBuild, { slot: 3 })).toThrow("That build does not exist.");
  });

  it("moves the build's cards back into its items from the player's cards, skipping cards no longer held", () => {
    const f = builder();
    f.run(server.saveBuild, { slot: 0 });
    // The player moves both cards to the Sky Bow and wears it instead.
    f.transaction(() => {
      setGearSlots(f.ctx, f.ctx.sender, "ion_bow", 0n, { slots: 2, cards: [] });
      setGearSlots(f.ctx, f.ctx.sender, "sky_bow", 0n, { slots: 2, cards: ["needle_card", "needle_card"] });
    });
    f.patch("playerProgress", { equippedRightHand: "sky_bow" });
    f.run(server.saveBuild, { slot: 1 });
    // Back to build 0: the Ion Bow wants two Needle cards; the player holds one, the Sky Bow keeps its two.
    f.patch("playerProgress", { equippedRightHand: "ion_bow" });
    f.run(server.applyBuildCards, { slot: 0 });
    expect(f.slots("ion_bow")).toEqual(["needle_card"]);
    expect(f.held()).toBe(0);
    // Build 1 takes the Sky Bow's cards out and back in: nothing is lost or made.
    f.run(server.applyBuildCards, { slot: 1 });
    expect(f.slots("sky_bow")).toEqual(["needle_card", "needle_card"]);
    expect(f.slots("ion_bow")).toEqual(["needle_card"]);
    expect(f.held()).toBe(0);
    expect(() => f.run(server.applyBuildCards, { slot: 2 })).toThrow("Save this build first.");
  });
});
