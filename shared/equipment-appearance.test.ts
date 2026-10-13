import { describe, expect, it } from "vitest";
import { HIDDEN_COSMETIC_ITEM_ID, resolveEquipmentAppearance } from "./equipment-appearance";

const regular = {
  equippedHead: "paper_hat",
  equippedChest: "wooden_armor",
  equippedFeet: "trailblazer_boots",
  equippedRightHand: "stone",
  equippedLeftHand: "",
};

describe("equipment appearance", () => {
  it("leaves a bare chest empty for the renderer to dress", () => {
    // The default body is a sprite the renderer lays over the bare torso, not
    // an item, so nothing is invented here and no stats come with it.
    expect(resolveEquipmentAppearance({ ...regular, equippedChest: "" }).chestItem).toBe("");
    expect(resolveEquipmentAppearance({
      ...regular,
      equippedChest: "",
      cosmeticChest: HIDDEN_COSMETIC_ITEM_ID,
    }).chestItem).toBe("");
  });

  it("falls back to regular equipment when cosmetic slots are empty", () => {
    expect(resolveEquipmentAppearance(regular)).toEqual({
      headItem: "paper_hat",
      chestItem: "wooden_armor",
      feetItem: "trailblazer_boots",
      rightHandItem: "stone",
      leftHandItem: "",
    });
  });

  it("overrides each outfit slot without mutating regular equipment", () => {
    expect(resolveEquipmentAppearance({
      ...regular,
      cosmeticHead: "gold_helmet",
      cosmeticChest: "frost_armor",
      cosmeticFeet: "frost_boots",
      cosmeticLeftHand: "frost_bow",
    })).toEqual({
      headItem: "gold_helmet",
      chestItem: "frost_armor",
      feetItem: "frost_boots",
      rightHandItem: "",
      leftHandItem: "frost_bow",
    });
    expect(regular.equippedRightHand).toBe("stone");
  });

  it("shows a hand look only on a weapon of its own kind, so what moves matches how it fights", () => {
    const swordsman = { ...regular, equippedRightHand: "iron_sword" };
    // A sword's look on a sword, and a bow's on a bow or the stone.
    expect(resolveEquipmentAppearance({ ...swordsman, cosmeticRightHand: "ion_sword" }).rightHandItem).toBe("ion_sword");
    expect(resolveEquipmentAppearance({ ...regular, equippedRightHand: "starter_bow", cosmeticRightHand: "galaxy_bow" }).rightHandItem).toBe("galaxy_bow");
    expect(resolveEquipmentAppearance({ ...regular, cosmeticRightHand: "galaxy_bow" }).rightHandItem).toBe("galaxy_bow");
    // Across kinds the weapon itself is drawn: no sword swinging out arrows, no bow drawn to strike.
    expect(resolveEquipmentAppearance({ ...regular, equippedRightHand: "starter_bow", cosmeticRightHand: "ion_sword" }))
      .toMatchObject({ rightHandItem: "starter_bow", leftHandItem: "" });
    expect(resolveEquipmentAppearance({ ...swordsman, cosmeticRightHand: "galaxy_bow" }).rightHandItem).toBe("iron_sword");
    expect(resolveEquipmentAppearance({ ...swordsman, cosmeticLeftHand: "galaxy_bow" })).toMatchObject({ rightHandItem: "iron_sword", leftHandItem: "" });
    // Hiding the hand works on either.
    expect(resolveEquipmentAppearance({ ...swordsman, cosmeticRightHand: HIDDEN_COSMETIC_ITEM_ID }).rightHandItem).toBe("");
  });

  it("gives a valid right-hand cosmetic precedence over a stale left hand", () => {
    expect(resolveEquipmentAppearance({
      ...regular,
      cosmeticRightHand: "bow",
      cosmeticLeftHand: "stale_bow",
    })).toMatchObject({ rightHandItem: "bow", leftHandItem: "" });
  });

  it("hides stat equipment without unequipping it", () => {
    expect(resolveEquipmentAppearance({
      ...regular,
      cosmeticHead: HIDDEN_COSMETIC_ITEM_ID,
      cosmeticChest: HIDDEN_COSMETIC_ITEM_ID,
      cosmeticFeet: HIDDEN_COSMETIC_ITEM_ID,
      cosmeticRightHand: HIDDEN_COSMETIC_ITEM_ID,
    })).toEqual({
      headItem: "",
      chestItem: "",
      feetItem: "",
      rightHandItem: "",
      leftHandItem: "",
    });
    expect(regular).toMatchObject({ equippedChest: "wooden_armor", equippedRightHand: "stone" });
  });
});
