import { describe, expect, it } from "vitest";
import { effectivePlayerPower } from "../../shared/player-power";
import { bestEquipmentMoves } from "./equip-best";
import { moveInventoryItem, type InventoryState } from "./inventory";

const inventory = (): InventoryState => ({
  itemIds: ["starter_stone", "starter_bow", "snow_bow", "frost_bow", "black_boots", "superior_golden_helmet", "frost_armor"],
  equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: "starter_stone", equippedLeftHand: "",
  cosmeticHead: "superior_golden_helmet", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "",
});
const power = (candidate: InventoryState) => effectivePlayerPower({
  ...candidate, maxHp: 1000, damage: 100, regen: 10, armor: 50, attackRate: .38,
}, null, id => id === "snow_bow" ? 10 : 0);

describe("equip best", () => {
  it("uses upgraded power rather than map tier, skips cosmetics, and includes boots", () => {
    const current = inventory();
    const before = structuredClone(current);
    expect(bestEquipmentMoves(current, power)).toEqual([
      { itemId: "snow_bow", destination: "RIGHT_HAND" },
      { itemId: "frost_armor", destination: "CHEST" },
      { itemId: "black_boots", destination: "FEET" },
    ]);
    expect(current).toEqual(before);
  });

  it("does nothing when already wearing the best gear", () => {
    const current = inventory();
    for (const move of bestEquipmentMoves(current, power)) moveInventoryItem(current, move.itemId, move.destination);
    expect(bestEquipmentMoves(current, power)).toEqual([]);
    expect(current.cosmeticHead).toBe("superior_golden_helmet");
  });

  it("preserves the equipped weapon on ties, including legacy left-hand equipment", () => {
    const current = inventory();
    current.equippedRightHand = "";
    current.equippedLeftHand = "frost_bow";
    expect(bestEquipmentMoves(current, () => 100).some(move => move.destination === "RIGHT_HAND")).toBe(false);
  });
});
