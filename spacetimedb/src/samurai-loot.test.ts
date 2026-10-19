import { reportEnemy } from "../../tests/helpers/enemy-defeat";
import { describe, expect, it, vi } from "vitest";
import { SAMURAI_HAT, SAMURAI_HAT_ITEM_DROP_DENOMINATOR, itemMaxHealthMultiplierBonus, itemRegenerationMultiplierBonus } from "../../shared/items";
import { SAMURAI_GARDEN_MAP_ID } from "../../shared/rules";
import { inventoryFromSave, inventoryItemQuantity, serialiseInventory } from "../../src/game/inventory";
import { crystalFixture } from "../../tests/helpers/crystal-hollows-fixture";
import { progressOf } from "../../tests/helpers/progress";

vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

function samuraiFixture() {
  const f = crystalFixture();
  f.patch("playerProgress", { equippedRightHand: "starter_stone", damage: 1e15 });
  f.patch("player", { mapId: SAMURAI_GARDEN_MAP_ID });
  f.ctx.random.integerInRange = vi.fn((_min, max) => max === SAMURAI_HAT_ITEM_DROP_DENOMINATOR ? 1 : max);
  return f;
}

describe("Samurai Gardens helmet", () => {
  it("keeps an owned helmet through inventory reload, in the head slot", () => {
    const f = samuraiFixture();
    f.patch("playerProgress", { inventoryJson: JSON.stringify([SAMURAI_HAT]) });
    const progress = progressOf(f, f.ctx.sender);
    const inventory = inventoryFromSave(progress.inventoryJson, "", SAMURAI_HAT, "", false);
    expect(inventory.equippedHead).toBe(SAMURAI_HAT);
    const reloaded = inventoryFromSave(serialiseInventory(inventory), "", SAMURAI_HAT, "", false);
    expect(inventoryItemQuantity(reloaded, SAMURAI_HAT)).toBe(1);
    expect(itemMaxHealthMultiplierBonus(SAMURAI_HAT)).toBe(0);
    expect(itemRegenerationMultiplierBonus(SAMURAI_HAT)).toBeCloseTo(.2857, 4);
  });

  it("no longer drops from kills, not even on what was its winning roll", () => {
    const f = samuraiFixture();
    reportEnemy(f);
    reportEnemy(f);
    expect(f.ctx.random.integerInRange).not.toHaveBeenCalledWith(1, SAMURAI_HAT_ITEM_DROP_DENOMINATOR);
    expect(progressOf(f, f.ctx.sender).inventoryJson).toBe("[]");
    expect([...f.db.playerItemDrop.iter()]).toHaveLength(0);
  });

  it("drops no gear on another map either", () => {
    const f = samuraiFixture();
    f.patch("player", { mapId: "crystal_hollows" });
    f.ctx.random.integerInRange = () => 1;
    reportEnemy(f);
    expect([...f.db.playerItemDrop.iter()]).toHaveLength(0);
  });
});
