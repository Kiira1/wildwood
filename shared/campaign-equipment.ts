import { equipmentStatDefinition } from "./equipment-budget";
import type { ItemDefinition } from "./items";

// Catalog additions and their per-enemy loot odds share one declaration, so new
// campaign maps cannot accidentally advertise equipment without awarding it.
function equipment(id: string, name: string, slot: "HEAD" | "CHEST" | "HAND", tier: number): ItemDefinition {
  return {
    id, name: name.toUpperCase(), slot, acquisition: "CAMPAIGN_DROP",
    description: slot === "HAND" ? "A bow that increases damage." : slot === "HEAD" ? "A helmet that increases regeneration." : "Armor that increases maximum health.",
    ...equipmentStatDefinition(tier, slot),
  };
}
function drop(mapId: string, definition: ItemDefinition, wins: number, outcomes: number) {
  return { mapId, definition, wins, outcomes };
}

/**
 * Swords, one to a map. They strike up close, so each hits half as hard again as its map's
 * bows to make up for standing in reach of what it fights, and drops as often as that map's bow. The Wooden
 * Sword, until now a developer's practice weapon, is the forest's.
 */
export const SWORD_DAMAGE_FACTOR = 1.5;
export const SWORD_REACH = 75;
function sword(id: string, name: string, tier: number): ItemDefinition {
  const bow = equipmentStatDefinition(tier, "HAND").weapon?.damageMultiplierBonus ?? 0;
  const percent = Math.round(bow * SWORD_DAMAGE_FACTOR * 10_000) / 100;
  return {
    id, name: name.toUpperCase(), slot: "HAND", acquisition: "CAMPAIGN_DROP",
    description: "A sword that increases damage. It strikes up close.",
    stats: [`DAMAGE +${percent}%`], weapon: { mode: "MELEE", range: SWORD_REACH, damageMultiplierBonus: percent / 100, tier },
  };
}

export const CAMPAIGN_EQUIPMENT = {
  // Swords, at each map's bow odds (shared/items.ts has the first maps' as constants; a map with no regular bow,
  // Lava Lake, takes its helmet's).
  wooden_sword: drop("tutorial_forest", sword("wooden_sword", "Wooden Sword", 1), 1, 25),
  iron_sword: drop("beginner_desert", sword("iron_sword", "Iron Sword", 2), 1, 50),
  snow_sword: drop("intermediate_snowlands", sword("snow_sword", "Snow Sword", 3), 1, 50),
  lava_sword: drop("advanced_lava_wastes", sword("lava_sword", "Lava Sword", 4), 1, 125),
  night_sword: drop("infernal_depths", sword("night_sword", "Night Sword", 5), 1, 100),
  sky_sword: drop("water_reach", sword("sky_sword", "Sky Sword", 6), 7, 1000),
  samurai_sword: drop("samurai_garden", sword("samurai_sword", "Samurai Sword", 7), 13, 2000),
  cloudspire_sword: drop("cloudspire", sword("cloudspire_sword", "Cloudspire Sword", 8), 1, 200),
  moonfen_sword: drop("moonfen", sword("moonfen_sword", "Moonfen Sword", 9), 1, 200),
  crystal_sword: drop("crystal_hollows", sword("crystal_sword", "Crystalwing Sword", 10), 1, 200),
  clockwork_sword: drop("clockwork_ruins", sword("clockwork_sword", "Clockwork Sword", 11), 1, 200),
  duskfall_sword: drop("duskfall_orchard", sword("duskfall_sword", "Duskwing Sword", 12), 1, 200),
  neon_sword: drop("neon_bastion", sword("neon_sword", "Neon Arc Sword", 13), 1, 200),
  verdant_sword: drop("verdant_catacombs", sword("verdant_sword", "Bonewing Sword", 14), 1, 200),
  ion_sword: drop("ion_citadel", sword("ion_sword", "Ion Sovereign Sword", 15), 1, 200),
  forest_cap: drop("tutorial_forest", equipment("forest_cap", "Forest Cap", "HEAD", 1), 1, 25),
  desert_armor: drop("beginner_desert", equipment("desert_armor", "Desert Armor", "CHEST", 2), 1, 50),
  snow_helmet: drop("intermediate_snowlands", equipment("snow_helmet", "Snow Helmet", "HEAD", 3), 1, 50),
  night_armor: drop("infernal_depths", equipment("night_armor", "Night Armor", "CHEST", 5), 7, 1000),
  water_helmet: drop("water_reach", equipment("water_helmet", "Tideguard Helmet", "HEAD", 6), 1, 125),
  samurai_armor: drop("samurai_garden", equipment("samurai_armor", "Samurai Armor", "CHEST", 7), 7, 1000),
  moonfen_bow: drop("moonfen", equipment("moonfen_bow", "Moonfen Bow", "HAND", 9), 1, 200),
  moonfen_helmet: drop("moonfen", equipment("moonfen_helmet", "Moonfen Crown", "HEAD", 9), 1, 125),
  crystal_bow: drop("crystal_hollows", equipment("crystal_bow", "Crystalwing Bow", "HAND", 10), 1, 200),
  crystal_armor: drop("crystal_hollows", equipment("crystal_armor", "Crystalplate Armor", "CHEST", 10), 7, 1000),
  crystal_helmet: drop("crystal_hollows", equipment("crystal_helmet", "Crystalguard Helmet", "HEAD", 10), 1, 125),
  clockwork_bow: drop("clockwork_ruins", equipment("clockwork_bow", "Clockwork Bow", "HAND", 11), 1, 200),
  clockwork_armor: drop("clockwork_ruins", equipment("clockwork_armor", "Clockwork Armor", "CHEST", 11), 7, 1000),
  clockwork_helmet: drop("clockwork_ruins", equipment("clockwork_helmet", "Clockwork Visor", "HEAD", 11), 1, 125),
  duskfall_bow: drop("duskfall_orchard", equipment("duskfall_bow", "Duskwing Bow", "HAND", 12), 1, 200),
  duskfall_armor: drop("duskfall_orchard", equipment("duskfall_armor", "Duskfall Mantle", "CHEST", 12), 7, 1000),
  duskfall_helmet: drop("duskfall_orchard", equipment("duskfall_helmet", "Duskfall Antlers", "HEAD", 12), 1, 125),
  neon_bow: drop("neon_bastion", equipment("neon_bow", "Neon Arc Bow", "HAND", 13), 1, 200),
  neon_armor: drop("neon_bastion", equipment("neon_armor", "Neon Bastion Armor", "CHEST", 13), 7, 1000),
  neon_helmet: drop("neon_bastion", equipment("neon_helmet", "Neon Crest", "HEAD", 13), 1, 125),
  verdant_bow: drop("verdant_catacombs", equipment("verdant_bow", "Bonewing Bow", "HAND", 14), 1, 200),
  verdant_armor: drop("verdant_catacombs", equipment("verdant_armor", "Catacomb Mantle", "CHEST", 14), 7, 1000),
  verdant_helmet: drop("verdant_catacombs", equipment("verdant_helmet", "Catacomb Skullhelm", "HEAD", 14), 1, 125),
  ion_bow: drop("ion_citadel", equipment("ion_bow", "Ion Sovereign Bow", "HAND", 15), 1, 200),
  ion_armor: drop("ion_citadel", equipment("ion_armor", "Ion Sovereign Armor", "CHEST", 15), 7, 1000),
  ion_helmet: drop("ion_citadel", equipment("ion_helmet", "Ion Sovereign Helmet", "HEAD", 15), 1, 125),
} as const;

export type CampaignItemId = keyof typeof CAMPAIGN_EQUIPMENT;
export const CAMPAIGN_ITEM_DEFINITIONS = Object.fromEntries(
  Object.entries(CAMPAIGN_EQUIPMENT).map(([id, entry]) => [id, entry.definition]),
) as { [Id in CampaignItemId]: ItemDefinition & { id: Id } };
