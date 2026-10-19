import { describe, expect, it } from "vitest";
import { armorClassLines } from "./item-inspection-controller";

describe("armor class lines in the item window", () => {
  it("shows the perk, and whether the set is on only for a piece its wearer has on", () => {
    expect(armorClassLines("rare_light_helmet")).toEqual(["Light: +3% Move Speed", "Set: Light Helmet + Armor + Bow · +5% Damage"]);
    expect(armorClassLines("rare_heavy_armor")).toEqual(["Heavy: -4% Move Speed"]);
    expect(armorClassLines("rare_bow")).toEqual([]);
    const worn = { equippedRightHand: "rare_bow", equippedHead: "rare_light_helmet", equippedChest: "rare_light_armor" };
    expect(armorClassLines("rare_light_armor", worn)[1]).toBe("Set: Light Helmet + Armor + Bow · +5% Damage · Active");
    expect(armorClassLines("rare_light_armor", { ...worn, equippedRightHand: "rare_sword" })[1]).toMatch(/· Inactive$/);
    // A copy in the bag is not the one worn.
    expect(armorClassLines("epic_light_armor", worn)[1]).toBe("Set: Light Helmet + Armor + Bow · +5% Damage");
  });
});
