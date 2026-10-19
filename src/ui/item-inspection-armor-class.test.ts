import { describe, expect, it } from "vitest";
import { armorClassLines } from "./item-inspection-controller";
import { formatEquipmentStat } from "./equipment-stat-format";

describe("armor class lines in the item window", () => {
  it("shows the perk, and whether the set is on only for a piece its wearer has on", () => {
    expect(armorClassLines("rare_light_helmet")).toEqual(["Light: +3% Move Speed", "Set: Light Helmet + Armor + Bow · +5% Damage"]);
    expect(armorClassLines("rare_heavy_armor")).toEqual(["Heavy: -4% Move Speed"]);
    // Medium has no perk of its own, only its set.
    expect(armorClassLines("rare_medium_helmet")).toEqual(["Set: Medium Helmet + Armor + Sword · +5% Damage"]);
    expect(armorClassLines("rare_bow")).toEqual([]);
    const worn = { equippedRightHand: "rare_bow", equippedHead: "rare_light_helmet", equippedChest: "rare_light_armor" };
    expect(armorClassLines("rare_light_armor", worn)[1]).toBe("Set: Light Helmet + Armor + Bow · +5% Damage · Active");
    expect(armorClassLines("rare_light_armor", { ...worn, equippedRightHand: "rare_sword" })[1]).toMatch(/· Inactive$/);
    // A copy in the bag is not the one worn.
    expect(armorClassLines("epic_light_armor", worn)[1]).toBe("Set: Light Helmet + Armor + Bow · +5% Damage");
  });

  it("names graded boots' style and the school it belongs to", () => {
    expect(armorClassLines("rare_ranger_boots")).toEqual(["Ranger Boots · Archery"]);
    expect(armorClassLines("rare_warrior_boots")).toEqual(["Warrior Boots · Swordplay"]);
    expect(armorClassLines("rare_mystic_boots")).toEqual(["Mystic Boots · Sorcery"]);
    expect(armorClassLines("black_boots")).toEqual([]);
  });

  it("rounds a stat to at most one decimal", () => {
    expect(formatEquipmentStat("Max Health +40.95%")).toBe("Max Health +41%");
    expect(formatEquipmentStat("Regen +70.4%")).toBe("Regen +70.4%");
    expect(formatEquipmentStat("Damage +9.9%")).toBe("Damage +9.9%");
    expect(formatEquipmentStat("+11.43")).toBe("+11.4");
  });
});
