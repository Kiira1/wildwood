import { describe, expect, it } from "vitest";
import { addPlayerBaseMaxHealth, applyPlayerMaxHealthBonus } from "./player-health";

describe("equipment max health", () => {
  it("applies and removes Wooden Armor without compounding the base save stat", () => {
    const player = { hp: 50, baseMaxHp: 100, maxHp: 100 };
    applyPlayerMaxHealthBonus(player, 25);
    expect(player).toEqual({ hp: 62.5, baseMaxHp: 100, maxHp: 125 });
    applyPlayerMaxHealthBonus(player, 0);
    expect(player).toEqual({ hp: 50, baseMaxHp: 100, maxHp: 100 });
  });

  it("adds earned health without multiplying it or saving the equipment bonus", () => {
    const player = { hp: 125, baseMaxHp: 100, maxHp: 125 };
    addPlayerBaseMaxHealth(player, 20, 25);
    expect(player).toEqual({ hp: 145, baseMaxHp: 120, maxHp: 145 });
  });
});
