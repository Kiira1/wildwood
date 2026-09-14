import { describe, expect, it, vi } from "vitest";
import { SAMURAI_HAT, SAMURAI_HAT_ITEM_DROP_DENOMINATOR, itemMaxHealthMultiplier, itemRegenerationMultiplier } from "../../shared/items";
import { SAMURAI_GARDEN_MAP_ID } from "../../shared/rules";
import { inventoryFromSave, inventoryItemQuantity, serialiseInventory } from "../../src/game/inventory";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";

vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

function samuraiFixture() {
  const f = crystalFixture();
  f.patch("player", { mapId: SAMURAI_GARDEN_MAP_ID });
  f.ctx.random.integerInRange = vi.fn(() => 1);
  return f;
}

describe("Samurai Gardens helmet drop", () => {
  it("awards a helmet that survives inventory reload and can occupy the head slot", () => {
    const f = samuraiFixture();
    f.run(server.recordLavaEnemyDefeat);
    expect(f.ctx.random.integerInRange).toHaveBeenCalledWith(1, SAMURAI_HAT_ITEM_DROP_DENOMINATOR);
    const progress = f.db.playerProgress.identity.find(f.ctx.sender);
    const inventory = inventoryFromSave(progress.inventoryJson, "", SAMURAI_HAT, "", false);
    expect(inventory.equippedHead).toBe(SAMURAI_HAT);
    const reloaded = inventoryFromSave(serialiseInventory(inventory), "", SAMURAI_HAT, "", false);
    expect(inventoryItemQuantity(reloaded, SAMURAI_HAT)).toBe(1);
    expect([...f.db.playerItemDrop.iter()]).toMatchObject([{ itemId: SAMURAI_HAT, alreadyOwned: false, sequence: 1n }]);
    expect(itemMaxHealthMultiplier(SAMURAI_HAT)).toBe(2);
    expect(itemRegenerationMultiplier(SAMURAI_HAT)).toBe(2.2);
  });

  it("reports a repeat drop without duplicating the item", () => {
    const f = samuraiFixture();
    f.run(server.recordLavaEnemyDefeat);
    f.run(server.recordLavaEnemyDefeat);
    const saved = JSON.parse(f.db.playerProgress.identity.find(f.ctx.sender).inventoryJson);
    expect(saved.filter((id: string) => id === SAMURAI_HAT)).toHaveLength(1);
    expect([...f.db.playerItemDrop.iter()]).toMatchObject([{ itemId: SAMURAI_HAT, alreadyOwned: true, sequence: 2n }]);
  });

  it("does not award a helmet on a missed roll", () => {
    const f = samuraiFixture();
    f.ctx.random.integerInRange = () => 2;
    f.run(server.recordLavaEnemyDefeat);
    expect(f.db.playerProgress.identity.find(f.ctx.sender).inventoryJson).toBe("[]");
    expect([...f.db.playerItemDrop.iter()]).toHaveLength(0);
  });

  it("does not roll Samurai loot from another map", () => {
    const f = samuraiFixture();
    f.patch("player", { mapId: "crystal_hollows" });
    f.run(server.recordLavaEnemyDefeat);
    expect(f.ctx.random.integerInRange).not.toHaveBeenCalled();
    expect([...f.db.playerItemDrop.iter()]).toHaveLength(0);
  });
});
