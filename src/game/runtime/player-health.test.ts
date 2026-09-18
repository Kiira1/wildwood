import { describe, expect, it } from "vitest";
import { addPlayerBaseMaxHealth, applyPlayerMaxHealthMultiplierBonus, setPlayerBaseMaxHealth } from "./player-health";

describe("equipment max health", () => {
  it("applies and removes Wooden Armor without compounding the base save stat", () => {
    const player = { hp: 50, baseMaxHp: 100, maxHp: 100 };
    applyPlayerMaxHealthMultiplierBonus(player, .25);
    expect(player).toEqual({ hp: 62.5, baseMaxHp: 100, maxHp: 125 });
    applyPlayerMaxHealthMultiplierBonus(player, 0);
    expect(player).toEqual({ hp: 50, baseMaxHp: 100, maxHp: 100 });
  });

  it("scales newly earned health without saving the equipment bonus", () => {
    const player = { hp: 125, baseMaxHp: 100, maxHp: 125 };
    addPlayerBaseMaxHealth(player, 20, .25);
    expect(player).toEqual({ hp: 150, baseMaxHp: 120, maxHp: 150 });
  });
});


it("reconciles earned health and equipment without compounding Vitality or upgrades", () => {
  // Saved health already contains 20% Vitality. +10 wooden armor adds 9% gear.
  const player = { hp: 60, baseMaxHp: 120, maxHp: 120 };
  applyPlayerMaxHealthMultiplierBonus(player, .09);
  expect(player.maxHp).toBeCloseTo(130.8);
  expect(player.hp).toBeCloseTo(65.4);
  for (let i = 0; i < 3; i++) setPlayerBaseMaxHealth(player, 144, .09);
  expect(player.baseMaxHp).toBe(144);
  expect(player.maxHp).toBeCloseTo(156.96);
  expect(player.hp).toBeCloseTo(78.48);
  applyPlayerMaxHealthMultiplierBonus(player, 0);
  expect(player.maxHp).toBe(144);
  expect(player.hp).toBe(72);
});
