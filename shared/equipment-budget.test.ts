import { describe, expect, it } from "vitest";
import { flatEquipmentBudget } from "./equipment-budget";
import { referenceBuildForMap, BOSS_TARGET_SECONDS } from "./progression";
import { ITEM_DEFINITIONS, itemDamageBonus, itemMaxHealthBonus, itemRegenerationBonus, itemStats } from "./items";
import { itemTier } from "./item-tier";
import { personalBossDefinition } from "./personal-bosses";
import { MAP_IDS } from "./rules";

describe("gear cannot supply campaign progression by itself", () => {
  it("bounds every item, including rare originals, at 20% entry stats and 36% at +10", () => {
    for (const item of Object.values(ITEM_DEFINITIONS)) {
      const tier = itemTier(item.id); if (!tier || item.cosmeticOnly || item.slot === "FEET") continue;
      const budget = flatEquipmentBudget(tier);
      for (const level of [0, 10]) {
        const multiplier = 1 + .08 * level;
        expect(itemDamageBonus(item.id, level), item.id).toBeLessThanOrEqual(budget.damage * multiplier + .01);
        expect(itemMaxHealthBonus(item.id, level), item.id).toBeLessThanOrEqual(budget.health * multiplier + .01);
        expect(itemRegenerationBonus(item.id, level), item.id).toBeLessThanOrEqual(budget.regen * multiplier + .01);
      }
      // Labels must follow the same catalog, never old hard-coded bonuses.
      if (item.id !== "starter_stone") expect(itemStats(item.id)).toEqual(item.stats);
    }
  });
  it.each(Array.from({ length: 13 }, (_, i) => i + 2))("tier %i maxed gear cannot outdamage the next boss regen alone", tier => {
    const entry = referenceBuildForMap(tier - 2);
    const bonus = flatEquipmentBudget(tier).damage * 1.8;
    const nextBoss = personalBossDefinition(MAP_IDS[tier])!;
    const gearDps = bonus / entry.attackInterval;
    expect(gearDps).toBeLessThan(nextBoss.hp * .001);
    // Even with the map-entry earned damage added, a new set cannot immediately
    // meet the next map's target boss clear time, before accounting for regen.
    expect(nextBoss.hp / ((entry.damage + bonus) / entry.attackInterval)).toBeGreaterThan(BOSS_TARGET_SECONDS);
  });
});
