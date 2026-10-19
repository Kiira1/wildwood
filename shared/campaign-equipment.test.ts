import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_EQUIPMENT, SWORD_DAMAGE_FACTOR, SWORD_REACH } from "./campaign-equipment";
import { equipmentStatDefinition } from "./equipment-budget";
import { isGradeItemId } from "./grade-equipment";
import { canonicalItemId, EQUIPMENT_DROP_ITEM_IDS, ITEM_DEFINITIONS, STARTER_STAFF, itemDefinition, inventoryJsonItemQuantity, itemFitsEquipmentSlot } from "./items";
import { itemTier } from "./item-tier";
import { inventoryFromSave, serialiseInventory } from "../src/game/inventory";
import { itemPresentation, projectileKindForWeapon } from "../src/game/item-presentation";
import { mapGuideDrops } from "../src/ui/map-guide-controller";
import { regularMapLoot } from "./regular-map-loot";

const maps = ["tutorial_forest", "beginner_desert", "intermediate_snowlands", "advanced_lava_wastes", "infernal_depths", "water_reach", "samurai_garden", "cloudspire", "moonfen", "crystal_hollows", "clockwork_ruins", "duskfall_orchard", "neon_bastion", "verdant_catacombs", "ion_citadel"];

describe("campaign equipment progression", () => {
  it.each(maps)("drops no gear on %s: gear is bought at the Smith", map => {
    expect(mapGuideDrops(map).filter(drop => !itemDefinition(drop.itemId)?.cosmeticOnly)).toEqual([]);
  });
  it("keeps base damage, health, and regeneration bonuses increasing through the campaign tiers", () => {
    const previous = { damage: 0, health: 0, regen: 0 };
    for (const slot of ["HEAD", "CHEST", "HAND"] as const) {
      previous.damage = previous.health = previous.regen = 0;
      for (const map of maps) {
        const tier = maps.indexOf(map) + 1;
        const items = Object.values(ITEM_DEFINITIONS).filter(item => item.slot === slot && itemTier(item.id) === tier);
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
    if (slot === "HAND") expect(projectileKindForWeapon(id)).toBe(entry.definition.weapon?.mode === "MELEE" ? undefined : entry.definition.weapon?.projectile);
    // Still defined and kept by whoever owns it, with its map's tier, but no longer dropped.
    expect(itemTier(id)).toBe(maps.indexOf(entry.mapId) + 1);
    expect(regularMapLoot(entry.mapId).map(drop => drop.itemId)).not.toContain(id);
  });
  it("leaves every campaign map and Endless without campaign drops", () => {
    for (const map of [...maps, "endless_1"]) {
      expect(regularMapLoot(map).map(drop => drop.itemId).filter(id => id in CAMPAIGN_EQUIPMENT), map).toEqual([]);
    }
  });
});

describe("swords", () => {
  const swords = Object.entries(CAMPAIGN_EQUIPMENT).filter(([, entry]) => entry.definition.weapon?.mode === "MELEE");

  it("gives every map one sword, of that map's tier", () => {
    expect(swords.map(([, entry]) => entry.mapId)).toEqual(maps);
    swords.forEach(([id], index) => expect(itemTier(id), id).toBe(index + 1));
  });

  it.each(swords)("makes %s hit half as hard again as its tier's best bow, up close", (id, entry) => {
    const tier = itemTier(id);
    const bows = Object.values(ITEM_DEFINITIONS).filter(item => item.weapon?.mode === "RANGED" && item.weapon.tier === tier && !isGradeItemId(item.id));
    const bow = Math.max(...bows.map(item => item.weapon?.damageMultiplierBonus ?? 0));
    const damage = entry.definition.weapon?.damageMultiplierBonus ?? 0;
    expect(bow).toBeGreaterThan(0);
    expect(damage).toBeCloseTo(bow * SWORD_DAMAGE_FACTOR, 3);
    expect(entry.definition.weapon).toMatchObject({ mode: "MELEE", range: SWORD_REACH, tier });
    expect(entry.definition.stats).toEqual([`DAMAGE +${+(damage * 100).toFixed(2)}%`]);
  });

  it.each(swords)("no longer drops %s on its map", (id, entry) => {
    expect(regularMapLoot(entry.mapId).find(drop => drop.itemId === id)).toBeUndefined();
  });

  it("draws every sword from its own art, swung in hand", () => {
    const sources = swords.map(([id]) => itemPresentation(id)!.inventory.source);
    expect(new Set(sources).size).toBe(swords.length);
    for (const [id] of swords) {
      expect(itemPresentation(id)!.world, id).toMatchObject({ kind: "SPRITE", layer: "HAND", handAction: "SWING", weaponCategory: "SWORD" });
    }
  });
});

describe("staffs", () => {
  const staffs = Object.entries(CAMPAIGN_EQUIPMENT).filter(([, entry]) => entry.definition.weapon?.projectile === "BOLT");

  it("gives every map one staff, of that map's tier", () => {
    expect(staffs.map(([, entry]) => entry.mapId)).toEqual(maps);
    staffs.forEach(([id], index) => expect(itemTier(id), id).toBe(index + 1));
  });

  it.each(staffs)("gives %s its tier's full bow bonus, and no longer drops it", (id, entry) => {
    const tier = itemTier(id)!;
    expect(entry.definition.weapon).toMatchObject({ mode: "RANGED", projectile: "BOLT", tier, damageMultiplierBonus: equipmentStatDefinition(tier, "HAND").weapon!.damageMultiplierBonus });
    expect(regularMapLoot(entry.mapId).find(drop => drop.itemId === id)).toBeUndefined();
  });

  it("draws every staff from its own art, held to cast, firing bolts", () => {
    const sources = [...staffs.map(([id]) => itemPresentation(id)!.inventory.source), itemPresentation(STARTER_STAFF)!.inventory.source];
    expect(new Set(sources).size).toBe(staffs.length + 1);
    for (const id of [...staffs.map(([id]) => id), STARTER_STAFF]) {
      expect(itemPresentation(id)!.world, id).toMatchObject({ kind: "SPRITE", layer: "HAND", handAction: "CAST" });
      expect(projectileKindForWeapon(id)).toBe("BOLT");
      expect(readFileSync(new URL(`../public/${itemPresentation(id)!.inventory.source}`, import.meta.url)).length).toBeGreaterThan(100);
    }
  });

  it("keeps the Smith's Starter Staff in the bag like a drop, with no stats and no tier", () => {
    expect(EQUIPMENT_DROP_ITEM_IDS).toContain(STARTER_STAFF);
    expect(itemTier(STARTER_STAFF)).toBeUndefined();
    expect(itemDefinition(STARTER_STAFF)!.weapon).toEqual({ mode: "RANGED", projectile: "BOLT" });
    for (const map of maps) expect(regularMapLoot(map).map(drop => drop.itemId)).not.toContain(STARTER_STAFF);
  });
});
