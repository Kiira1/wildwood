import { describe, expect, it } from "vitest";
import { equipComparisonPower, fallbackWeapon, isEquipUpgrade, weaponKind } from "./equip-best";
import { IRON_BOW, STARTER_BOW, STARTER_STONE, WOODEN_SWORD } from "./items";

const stats = { maxHp: 1000, damage: 100, attackRate: .38, armor: 50, regen: 10 };
const loadout = (rightHand: string) => ({
  ...stats, equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: rightHand, equippedLeftHand: "",
});
const power = (candidate: ReturnType<typeof loadout>) => equipComparisonPower(candidate);
const DESERT = { desertUnlocked: true };

describe("weapon kinds", () => {
  it("reads a sword as melee, and bows, the stone and an empty hand as ranged", () => {
    expect(weaponKind(WOODEN_SWORD)).toBe("MELEE");
    expect(weaponKind("ion_sword")).toBe("MELEE");
    for (const id of [STARTER_STONE, STARTER_BOW, "ion_bow", "", undefined, "not_an_item"]) expect(weaponKind(id)).toBe("RANGED");
  });

  it("never trades a bow for a sword or a sword for a bow, however hard it hits", () => {
    // The iron sword hits half as hard again as the iron bow, so power alone would take it.
    expect(power(loadout("iron_sword"))).toBeGreaterThan(power(loadout(IRON_BOW)));
    expect(isEquipUpgrade(loadout(STARTER_BOW), "iron_sword", power)).toBe(false);
    expect(isEquipUpgrade(loadout(STARTER_STONE), WOODEN_SWORD, power)).toBe(false);
    expect(isEquipUpgrade(loadout(WOODEN_SWORD), "ion_bow", power)).toBe(false);
    // Within a kind the better weapon still wins.
    expect(isEquipUpgrade(loadout(STARTER_BOW), IRON_BOW, power)).toBe(true);
    expect(isEquipUpgrade(loadout(WOODEN_SWORD), "iron_sword", power)).toBe(true);
    expect(isEquipUpgrade(loadout("iron_sword"), WOODEN_SWORD, power)).toBe(false);
    // A hand read as empty, its sword locked away, keeps that sword's kind when the caller says so.
    expect(isEquipUpgrade(loadout(""), WOODEN_SWORD, power)).toBe(false);
    expect(isEquipUpgrade(loadout(""), WOODEN_SWORD, power, "MELEE")).toBe(true);
    expect(isEquipUpgrade(loadout(""), STARTER_BOW, power, "MELEE")).toBe(false);
  });

  it("fills an empty hand with the strongest usable weapon of the kind it held", () => {
    const bag = [STARTER_STONE, STARTER_BOW, WOODEN_SWORD, IRON_BOW, "iron_sword"];
    // An archer is never handed a sword, even one that hits harder than every bow they own.
    expect(fallbackWeapon(bag, {})).toBe(STARTER_BOW);
    expect(fallbackWeapon(bag, DESERT)).toBe(IRON_BOW);
    expect(fallbackWeapon([WOODEN_SWORD], {})).toBe(STARTER_STONE);
    // A swordsman gets the strongest sword their maps allow,
    expect(fallbackWeapon(bag, {}, "MELEE")).toBe(WOODEN_SWORD);
    expect(fallbackWeapon(bag, DESERT, "MELEE")).toBe("iron_sword");
    // and with no usable sword the strongest ranged weapon, the stone at least.
    expect(fallbackWeapon([STARTER_BOW, "iron_sword"], {}, "MELEE")).toBe(STARTER_BOW);
    expect(fallbackWeapon(["iron_sword"], {}, "MELEE")).toBe(STARTER_STONE);
  });
});
