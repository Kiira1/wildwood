import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_EQUIPMENT, SWORD_DAMAGE_FACTOR, SWORD_REACH } from "./campaign-equipment";
import { canonicalItemId, EQUIPMENT_DROP_ITEM_IDS, ITEM_DEFINITIONS, itemDefinition, inventoryJsonItemQuantity, itemFitsEquipmentSlot } from "./items";
import { itemTier } from "./item-tier";
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
          health: Math.max(...items.map(item => item.modifiers?.maxHealthMultiplierBonus ?? 0)),
          regen: Math.max(...items.map(item => item.modifiers?.regenerationMultiplierBonus ?? 0)),
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
    if (slot === "HAND") expect(projectileKindForWeapon(id)).toBe(entry.definition.weapon?.mode === "MELEE" ? undefined : "ARROW");
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

describe("swords", () => {
  const swords = Object.entries(CAMPAIGN_EQUIPMENT).filter(([, entry]) => entry.definition.weapon?.mode === "MELEE");
  const odds = (drop: { wins: number; outcomes: number }) => drop.wins / drop.outcomes;

  it("gives every map one sword, of that map's tier", () => {
    expect(swords.map(([, entry]) => entry.mapId)).toEqual(maps);
    swords.forEach(([id], index) => expect(itemTier(id), id).toBe(index + 1));
  });

  it.each(swords)("makes %s hit half as hard again as its tier's best bow, up close", (id, entry) => {
    const tier = itemTier(id);
    const bows = Object.values(ITEM_DEFINITIONS).filter(item => item.weapon?.mode === "RANGED" && item.weapon.tier === tier);
    const bow = Math.max(...bows.map(item => item.weapon?.damageMultiplierBonus ?? 0));
    const damage = entry.definition.weapon?.damageMultiplierBonus ?? 0;
    expect(bow).toBeGreaterThan(0);
    expect(damage).toBeCloseTo(bow * SWORD_DAMAGE_FACTOR, 3);
    expect(entry.definition.weapon).toMatchObject({ mode: "MELEE", range: SWORD_REACH, tier });
    expect(entry.definition.stats).toEqual([`DAMAGE +${+(damage * 100).toFixed(2)}%`]);
  });

  it.each(swords)("drops %s as often as its map's bow", (id, entry) => {
    const loot = regularMapLoot(entry.mapId);
    const bows = loot.filter(drop => itemDefinition(drop.itemId)?.weapon?.mode === "RANGED");
    // Lava Lake's only bow is its boss's, so there the sword drops as often as the helmet.
    const expected = bows.length ? Math.max(...bows.map(odds)) : odds(loot.find(drop => itemDefinition(drop.itemId)?.slot === "HEAD")!);
    expect(odds(loot.find(drop => drop.itemId === id)!)).toBe(expected);
  });

  it("draws every sword from its own art, swung in hand", () => {
    const sources = swords.map(([id]) => itemPresentation(id)!.inventory.source);
    expect(new Set(sources).size).toBe(swords.length);
    for (const [id] of swords) {
      expect(itemPresentation(id)!.world, id).toMatchObject({ kind: "SPRITE", layer: "HAND", handAction: "SWING", weaponCategory: "SWORD" });
    }
  });
});
