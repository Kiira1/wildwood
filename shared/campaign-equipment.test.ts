import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_EQUIPMENT } from "./campaign-equipment";
import { canonicalItemId, EQUIPMENT_DROP_ITEM_IDS, itemDefinition, inventoryJsonItemQuantity, itemFitsEquipmentSlot } from "./items";
import { inventoryFromSave, serialiseInventory } from "../src/game/inventory";
import { itemPresentation, projectileKindForWeapon } from "../src/game/item-presentation";
import { mapGuideDrops } from "../src/ui/map-guide-controller";
import { regularMapLoot } from "./regular-map-loot";

const maps = ["tutorial_forest", "beginner_desert", "intermediate_snowlands", "advanced_lava_wastes", "infernal_depths", "water_reach", "samurai_garden", "cloudspire", "moonfen", "crystal_hollows", "clockwork_ruins", "duskfall_orchard", "neon_bastion", "verdant_catacombs", "ion_citadel"];

describe("campaign equipment progression", () => {
  it.each(maps)("offers every core slot from regular enemies or the boss on %s", map => {
    const slots = new Set(mapGuideDrops(map).map(drop => itemDefinition(drop.itemId)?.slot));
    expect([...slots]).toEqual(expect.arrayContaining(["HEAD", "CHEST", "HAND"]));
  });
  it("keeps base damage, health, and regeneration bonuses increasing through the campaign", () => {
    const previous = { damage: 0, health: 0, regen: 0 };
    for (const slot of ["HEAD", "CHEST", "HAND"] as const) {
      previous.damage = previous.health = previous.regen = 0;
      for (const map of maps) {
        const items = mapGuideDrops(map).map(drop => itemDefinition(drop.itemId)!).filter(item => item.slot === slot);
        const next = {
          damage: Math.max(...items.map(item => item.weapon?.damageMultiplierBonus ?? 0)),
          health: Math.max(...items.map(item => item.modifiers?.maxHealthBonus ?? 0)),
          regen: Math.max(...items.map(item => item.modifiers?.regenerationBonus ?? 0)),
        };
        for (const stat of ["damage", "health", "regen"] as const) {
          expect(next[stat], `${map} ${slot} ${stat}`).toBeGreaterThanOrEqual(previous[stat]);
          previous[stat] = next[stat];
        }
      }
    }
  });
  it.each(Object.entries(CAMPAIGN_EQUIPMENT))("retains and renders %s through save/equip/restore", (id, entry) => {
    expect(canonicalItemId(id)).toBe(id);
    expect(EQUIPMENT_DROP_ITEM_IDS).toContain(id);
    const slot = entry.definition.slot;
    const inventory = inventoryFromSave(JSON.stringify([id, id]), "", slot === "HEAD" ? id : "", slot === "CHEST" ? id : "", false, false, slot === "HAND" ? id : "");
    expect(inventory.itemIds.filter(item => item === id)).toHaveLength(1);
    expect(inventoryJsonItemQuantity(serialiseInventory(inventory), id)).toBe(1);
    expect(itemFitsEquipmentSlot(id, slot === "HAND" ? "RIGHT_HAND" : slot)).toBe(true);
    expect(slot === "HEAD" ? inventory.equippedHead : slot === "CHEST" ? inventory.equippedChest : inventory.equippedRightHand).toBe(id);
    const art = itemPresentation(id)!;
    expect(readFileSync(new URL(`../public/${art.inventory.source}`, import.meta.url)).length).toBeGreaterThan(100);
    expect(art.world).toMatchObject({ kind: "SPRITE", layer: slot });
    if (slot === "HAND") expect(projectileKindForWeapon(id)).toBe("ARROW");
    expect(regularMapLoot(entry.mapId)).toContainEqual({ itemId: id, wins: entry.wins, outcomes: entry.outcomes });
    expect(mapGuideDrops(entry.mapId)).toContainEqual(expect.objectContaining({ itemId: id, numerator: entry.wins, denominator: entry.outcomes }));
  });
  it("keeps later-map odds consistent and leaves Endless without campaign drops", () => {
    for (const map of maps.slice(9)) {
      for (const drop of regularMapLoot(map)) {
        const slot = itemDefinition(drop.itemId)!.slot;
        expect(drop.wins / drop.outcomes).toBe(slot === "HAND" ? .005 : slot === "HEAD" ? .008 : .007);
      }
    }
    expect(regularMapLoot("endless_1")).toEqual([]);
  });
});
