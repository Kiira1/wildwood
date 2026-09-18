import { describe, expect, it } from "vitest";
import { referenceBuildForMap, BOSS_TARGET_SECONDS } from "./progression";
import { ITEM_DEFINITIONS, itemDamageMultiplierBonus, itemMaxHealthMultiplierBonus, itemRegenerationMultiplierBonus, itemStats, equipmentDamage } from "./items";
import { itemTier } from "./item-tier";
import { personalBossDefinition } from "./personal-bosses";
import { MAP_IDS } from "./rules";

describe("gear cannot supply campaign progression by itself", () => {
  it("bounds every stat bonus at 40% base and 72% fully upgraded", () => {
    for (const item of Object.values(ITEM_DEFINITIONS)) {
      const tier = itemTier(item.id); if (!tier || item.cosmeticOnly || item.slot === "FEET") continue;
      for (const level of [0, 10]) {
        const multiplier = 1 + .08 * level;
        expect(itemDamageMultiplierBonus(item.id, level), item.id).toBeLessThanOrEqual(.4 * multiplier + .0001);
        expect(itemMaxHealthMultiplierBonus(item.id, level), item.id).toBeLessThanOrEqual(.4 * multiplier + .0001);
        expect(itemRegenerationMultiplierBonus(item.id, level), item.id).toBeLessThanOrEqual(.4 * multiplier + .0001);
      }
      // Labels must follow the same catalog, never old hard-coded bonuses.
      if (item.id !== "starter_stone") expect(itemStats(item.id)).toEqual(item.stats);
    }
  });
  it.each(Array.from({ length: 13 }, (_, i) => i + 2))("tier %i maxed gear cannot skip the next map with entry damage", tier => {
    const entry = referenceBuildForMap(tier - 2);
    const weapon = Object.values(ITEM_DEFINITIONS).filter(item => item.slot === "HAND" && itemTier(item.id) === tier)
      .sort((a, b) => itemDamageMultiplierBonus(b.id, 10) - itemDamageMultiplierBonus(a.id, 10))[0];
    const damage = equipmentDamage(entry.damage, weapon.id, "", "", 1, 10);
    const nextBoss = personalBossDefinition(MAP_IDS[tier])!;
    expect(equipmentDamage(0, weapon.id, "", "", 1, 10)).toBe(0);
    // Even with the map-entry earned damage added, a new set cannot immediately
    // meet the next map's target boss clear time, before accounting for regen.
    expect(nextBoss.hp / (damage / entry.attackInterval)).toBeGreaterThan(BOSS_TARGET_SECONDS);
  });
});
