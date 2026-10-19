import { reportEnemy } from "../../tests/helpers/enemy-defeat";
import { expect, it, vi } from "vitest";
import { CLOUDSPIRE_ARMOR, CLOUDSPIRE_BOW, CLOUDSPIRE_HELMET, MOONFEN_ARMOR, WATER_ARMOR, SKY_BOW, SAMURAI_BOW, itemDamageMultiplierBonus, itemMaxHealthMultiplierBonus, itemRegenerationMultiplierBonus } from "../../shared/items";
import { inventoryFromSave, inventoryItemQuantity, serialiseInventory } from "../../src/game/inventory";
import { crystalFixture } from "../../tests/helpers/crystal-hollows-fixture";
import { regularMapLoot } from "../../shared/regular-map-loot";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

// Gear is bought at the Smith now: these maps' old drops stay defined but never roll.
it.each(["water_reach", "samurai_garden", "cloudspire", "moonfen", "crystal_hollows", "endless_1", "home_exterior"])("rolls no gear in %s", mapId => {
  const f = crystalFixture(); f.patch("player", { mapId });
  f.patch("playerProgress", { equippedRightHand: "starter_stone", damage: 1e15 });
  f.ctx.random.integerInRange = vi.fn(() => 1);
  if (mapId === "home_exterior") expect(() => reportEnemy(f)).toThrow(); else reportEnemy(f);
  expect(regularMapLoot(mapId)).toEqual([]);
  expect(f.ctx.random.integerInRange).not.toHaveBeenCalled();
  expect([...f.db.playerItemDrop.iter()]).toEqual([]);
});

it("keeps owned Water Reach equipment through reloads without duplicates", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { equippedRightHand: "starter_stone", damage: 1e15, inventoryJson: JSON.stringify([WATER_ARMOR, SKY_BOW, WATER_ARMOR]) });
  const progress = progressOf(f, f.ctx.sender);
  const inventory = inventoryFromSave(progress.inventoryJson, "", "", WATER_ARMOR, false, false, SKY_BOW);
  const reloaded = inventoryFromSave(serialiseInventory(inventory), "", "", WATER_ARMOR, false, false, SKY_BOW);
  expect(reloaded.equippedChest).toBe(WATER_ARMOR);
  expect(reloaded.equippedRightHand).toBe(SKY_BOW);
  expect(inventoryItemQuantity(reloaded, WATER_ARMOR)).toBe(1);
  expect(inventoryItemQuantity(reloaded, SKY_BOW)).toBe(1);
  expect(itemMaxHealthMultiplierBonus(WATER_ARMOR)).toBeCloseTo(.2375, 4);
  expect(itemRegenerationMultiplierBonus(WATER_ARMOR)).toBe(0);
  expect(itemDamageMultiplierBonus(SKY_BOW)).toBeCloseTo(.2375, 4);
  expect(itemDamageMultiplierBonus(SAMURAI_BOW)).toBeCloseTo(.2857, 4);
});

it.each([
  [CLOUDSPIRE_HELMET, "HEAD"],
  [CLOUDSPIRE_BOW, "HAND"],
  ["cloudspire_sword", "HAND"],
  [CLOUDSPIRE_ARMOR, "CHEST"],
  [MOONFEN_ARMOR, "CHEST"],
] as const)("keeps an owned %s in its %s slot", (itemId, slot) => {
  const inventory = inventoryFromSave(JSON.stringify([itemId]), "", slot === "HEAD" ? itemId : "", slot === "CHEST" ? itemId : "", false, false, slot === "HAND" ? itemId : "");
  expect(inventoryItemQuantity(inventory, itemId)).toBe(1);
  expect(slot === "HEAD" ? inventory.equippedHead : slot === "HAND" ? inventory.equippedRightHand : inventory.equippedChest).toBe(itemId);
});

it("keeps the Cloudspire and Moonfen items' stats", () => {
  expect(itemDamageMultiplierBonus(CLOUDSPIRE_BOW)).toBeCloseTo(.3375, 4);
  expect(itemMaxHealthMultiplierBonus(CLOUDSPIRE_HELMET)).toBe(0);
  expect(itemRegenerationMultiplierBonus(CLOUDSPIRE_HELMET)).toBeCloseTo(.3375, 4);
  expect(itemMaxHealthMultiplierBonus(CLOUDSPIRE_ARMOR)).toBeCloseTo(.3375, 4);
  expect(itemRegenerationMultiplierBonus(CLOUDSPIRE_ARMOR)).toBe(0);
  expect(itemMaxHealthMultiplierBonus(MOONFEN_ARMOR)).toBeCloseTo(.3929, 4);
  expect(itemRegenerationMultiplierBonus(MOONFEN_ARMOR)).toBe(0);
});
