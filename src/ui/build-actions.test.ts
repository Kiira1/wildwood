import { describe, expect, it, vi } from "vitest";
import { createBuildActions } from "./build-actions";
import type { InventoryState } from "../game/inventory";
import { IRON_BOW, SAMURAI_HAT } from "../../shared/items";
import type { SavedBuild } from "../../shared/builds";

function setup(build: SavedBuild | null, options: { blocked?: string } = {}) {
  const inventory: InventoryState = { itemIds: [IRON_BOW, SAMURAI_HAT], equippedHead: "", equippedChest: "", equippedFeet: "",
    equippedRightHand: "", equippedLeftHand: "", cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "" } as InventoryState;
  const applyBuildCards = vi.fn(async () => ({ ok: true }));
  const afterGearChange = vi.fn();
  const actions = createBuildActions({
    coop: () => ({ builds: () => [build, null, null], saveBuild: async () => ({ ok: true }), applyBuildCards }),
    inventory, afterGearChange, blocked: () => options.blocked ?? null,
  });
  return { inventory, actions, applyBuildCards, afterGearChange };
}
const gear = (HAND: string, HEAD = "") => ({ HAND, HEAD, CHEST: "", FEET: "" });

describe("equipping a build", () => {
  it("puts the saved gear on, saves once, then puts the active cards back", async () => {
    const view = setup({ slot: 0, gear: gear(IRON_BOW, SAMURAI_HAT), cards: { HAND: ["needle_card"], HEAD: [], CHEST: [] } });
    const result = await view.actions.equip(0);
    expect(result).toMatchObject({ ok: true, missingGear: 0 });
    expect([view.inventory.equippedRightHand, view.inventory.equippedHead]).toEqual([IRON_BOW, SAMURAI_HAT]);
    expect(view.afterGearChange).toHaveBeenCalledOnce();
    expect(view.applyBuildCards).toHaveBeenCalledWith(0);
  });

  it("counts gear it could not put on, and still puts the cards back", async () => {
    const view = setup({ slot: 0, gear: gear("ion_bow"), cards: { HAND: [], HEAD: [], CHEST: [] } });
    const result = await view.actions.equip(0);
    expect(result.missingGear).toBe(1);
    expect(view.afterGearChange).not.toHaveBeenCalled();
    expect(view.applyBuildCards).toHaveBeenCalledOnce();
  });

  it("refuses an empty build or one blocked by a duel", async () => {
    expect(await setup(null).actions.equip(0)).toEqual({ ok: false, error: "Save this build first." });
    const blocked = setup({ slot: 0, gear: gear(IRON_BOW), cards: { HAND: [], HEAD: [], CHEST: [] } }, { blocked: "Finish Your Duel First" });
    expect(await blocked.actions.equip(0)).toEqual({ ok: false, error: "Finish Your Duel First" });
    expect(blocked.applyBuildCards).not.toHaveBeenCalled();
  });
});
