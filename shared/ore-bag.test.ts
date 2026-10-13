import { describe, expect, it } from "vitest";
import { ORE_ORDER, bagFullForOres, bagSlotsWithOres, oreDescription, oreKindsHeld, rockOreKinds, roomForOres } from "./ore-bag";
import { gearClaimSpace } from "./mailbox-equipment";
import { IRON_BOW, SAMURAI_HAT } from "./items";

// Ore stacks take a slot each in the bag, like any item.
const bag = (extraCopies: number, ores: Record<string, number> = {}, capacity = 5) =>
  ({ owned: [IRON_BOW, SAMURAI_HAT], equipped: [IRON_BOW], extraCopies, ores, capacity });

describe("ores in the bag", () => {
  it("take one slot a kind held, however many are in the stack", () => {
    expect(oreKindsHeld({ starshard: 1, copper_ore: 900, iron_ore: 0 })).toEqual(["copper_ore", "starshard"]);
    // The hat is one slot (the bow is worn), a kept copy one, and two kinds of ore two.
    expect(bagSlotsWithOres(bag(1, { copper_ore: 900, starshard: 1 }))).toBe(4);
    expect(ORE_ORDER).toEqual(["copper_ore", "iron_ore", "mithril_ore", "adamant_ore", "starshard"]);
  });

  it("need a free slot for a kind not held yet, and none for more of a kind held", () => {
    expect(roomForOres(bag(3), ["copper_ore"])).toEqual({ needed: ["copper_ore"], room: true });
    expect(roomForOres(bag(4), ["copper_ore"])).toEqual({ needed: ["copper_ore"], room: false });
    expect(roomForOres(bag(3, { copper_ore: 2 }), ["copper_ore"])).toEqual({ needed: [], room: true });
    // A Mysterious rock can give a Starshard too: room for both, before it is broken.
    const mysterious = rockOreKinds({ ore: "iron_ore", kind: "mysterious" });
    expect(mysterious).toEqual(["iron_ore", "starshard"]);
    expect(roomForOres(bag(2), mysterious)).toEqual({ needed: ["iron_ore", "starshard"], room: true });
    expect(roomForOres(bag(3), mysterious).room).toBe(false);
    expect(rockOreKinds({ ore: "iron_ore", kind: "large" })).toEqual(["iron_ore"]);
  });

  it("say what to free when the bag is full", () => {
    expect(bagFullForOres(["iron_ore"])).toBe("Your bag is full. Free a slot for Iron Ore.");
    expect(bagFullForOres(["iron_ore", "starshard"])).toBe("Your bag is full. Free 2 slots for Iron Ore and Starshard.");
  });

  it("count toward a Mailbox gear claim's space too", () => {
    expect(gearClaimSpace([SAMURAI_HAT], [], [], [IRON_BOW], 2).slotsToFree).toBe(0);
    expect(gearClaimSpace([SAMURAI_HAT], [], [], [IRON_BOW], 2, 1).slotsToFree).toBe(1);
  });

  it("each say what they refine and where they come from", () => {
    expect(oreDescription("copper_ore").use).toBe("The Smith refines Tier 1–4 gear with it, one a try.");
    expect(oreDescription("adamant_ore").use).toBe("The Smith refines Tier 13–15 gear with it, one a try.");
    expect(oreDescription("starshard").from).toContain("Mysterious rocks");
  });
});
