import { describe, expect, it } from "vitest";
import { gearForHighestMap, gearClaimSpace } from "./mailbox-equipment";
import { CAMPAIGN_UNLOCK_FIELDS } from "./equipment-access";
import { ITEM_DEFINITIONS, itemDefinition, itemDamageBonus, itemMaxHealthBonus, itemRegenerationBonus, isCosmeticOnlyItem } from "./items";
import { itemTier } from "./item-tier";
import { MAP_IDS } from "./rules";

describe("map gear gifts", () => {
  it("selects the best helmet, chest and weapon for every campaign tier", () => {
    const score = (id: string) => itemDamageBonus(id) + itemMaxHealthBonus(id) + itemRegenerationBonus(id) * 10;
    for (let tier = 1; tier <= 15; tier++) {
      const access = Object.fromEntries(CAMPAIGN_UNLOCK_FIELDS.map((field, i) => [field, i < tier - 1]));
      const gift = gearForHighestMap(access);
      expect(gift.mapId).toBe(MAP_IDS[tier - 1]);
      expect(gift.itemIds.map(id => itemDefinition(id)?.slot)).toEqual(["HEAD", "CHEST", "HAND"]);
      for (const id of gift.itemIds) {
        expect(itemTier(id)).toBe(tier);
        for (const other of Object.values(ITEM_DEFINITIONS)) {
          if (itemTier(other.id) === tier && other.slot === itemDefinition(id)?.slot && !isCosmeticOnlyItem(other.id)) expect(score(id)).toBeGreaterThanOrEqual(score(other.id));
        }
      }
    }
    expect(gearForHighestMap({ snowlandsUnlocked: true }).itemIds).toContain("frost_bow");
    expect(gearForHighestMap({ lavaUnlocked: true }).itemIds).toContain("lava_bow");
    expect(gearForHighestMap({ infernalUnlocked: true }).itemIds).toContain("fire_metal_bow");
    expect(gearForHighestMap({ ionCitadelUnlocked: true }).itemIds).toEqual(["ion_helmet", "ion_armor", "ion_bow"]);
  });
  it("counts only missing unique equipment; equipped items and cosmetics don't consume bag slots", () => {
    const owned = ["starter_bow", "starter_bow", "wooden_armor", "superior_golden_helmet"];
    expect(gearClaimSpace(owned, ["starter_bow"], [], ["starter_bow", "wooden_armor", "forest_cap"], 2)).toEqual({ missing: ["forest_cap"], slotsToFree: 0 });
    expect(gearClaimSpace(owned, [], [], ["forest_cap"], 2).slotsToFree).toBe(1);
    expect(gearClaimSpace(owned, [], [], ["starter_bow", "wooden_armor"], 1).slotsToFree).toBe(0);
    expect(gearClaimSpace([], [], ["starter_bow"], ["forest_cap"], 1).slotsToFree).toBe(1);
  });
});
