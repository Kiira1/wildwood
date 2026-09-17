import type { ItemDefinition } from "./items";

// Catalog additions and their per-enemy loot odds share one declaration, so new
// campaign maps cannot accidentally advertise equipment without awarding it.
function equipment(id: string, name: string, slot: "HEAD" | "CHEST" | "HAND", bonus: number, regen = 0): ItemDefinition {
  const stats = [slot === "HAND" ? `DAMAGE +${bonus}%` : `MAX HEALTH +${bonus}%`];
  if (regen) stats.push(`REGEN +${regen}%`);
  return {
    id, name: name.toUpperCase(), slot, acquisition: "CAMPAIGN_DROP",
    description: slot === "HAND" ? "A bow that increases damage." : regen ? "Armor that strengthens health and regeneration." : "A cap that increases maximum health.",
    stats,
    ...(slot === "HAND"
      ? { weapon: { mode: "RANGED" as const, projectile: "ARROW" as const, damageMultiplierBonus: bonus / 100 } }
      : { modifiers: { maxHealthMultiplierBonus: bonus / 100, ...(regen ? { regenerationMultiplierBonus: regen / 100 } : {}) } }),
  };
}
function drop(mapId: string, definition: ItemDefinition, wins: number, outcomes: number) {
  return { mapId, definition, wins, outcomes };
}

export const CAMPAIGN_EQUIPMENT = {
  forest_cap: drop("tutorial_forest", equipment("forest_cap", "Forest Cap", "HEAD", 5, 0), 1, 25),
  desert_armor: drop("beginner_desert", equipment("desert_armor", "Desert Armor", "CHEST", 25, 25), 1, 50),
  snow_helmet: drop("intermediate_snowlands", equipment("snow_helmet", "Snow Helmet", "HEAD", 12, 10), 1, 50),
  night_armor: drop("infernal_depths", equipment("night_armor", "Night Armor", "CHEST", 60, 60), 7, 1000),
  water_helmet: drop("water_reach", equipment("water_helmet", "Tideguard Helmet", "HEAD", 80, 100), 1, 125),
  samurai_armor: drop("samurai_garden", equipment("samurai_armor", "Samurai Armor", "CHEST", 100, 100), 7, 1000),
  moonfen_bow: drop("moonfen", equipment("moonfen_bow", "Moonfen Bow", "HAND", 140, 0), 1, 200),
  moonfen_helmet: drop("moonfen", equipment("moonfen_helmet", "Moonfen Crown", "HEAD", 140, 160), 1, 125),
  crystal_bow: drop("crystal_hollows", equipment("crystal_bow", "Crystalwing Bow", "HAND", 160, 0), 1, 200),
  crystal_armor: drop("crystal_hollows", equipment("crystal_armor", "Crystalplate Armor", "CHEST", 160, 160), 7, 1000),
  crystal_helmet: drop("crystal_hollows", equipment("crystal_helmet", "Crystalguard Helmet", "HEAD", 160, 180), 1, 125),
  clockwork_bow: drop("clockwork_ruins", equipment("clockwork_bow", "Clockwork Bow", "HAND", 180, 0), 1, 200),
  clockwork_armor: drop("clockwork_ruins", equipment("clockwork_armor", "Clockwork Armor", "CHEST", 180, 180), 7, 1000),
  clockwork_helmet: drop("clockwork_ruins", equipment("clockwork_helmet", "Clockwork Visor", "HEAD", 180, 200), 1, 125),
  duskfall_bow: drop("duskfall_orchard", equipment("duskfall_bow", "Duskwing Bow", "HAND", 200, 0), 1, 200),
  duskfall_armor: drop("duskfall_orchard", equipment("duskfall_armor", "Duskfall Mantle", "CHEST", 200, 200), 7, 1000),
  duskfall_helmet: drop("duskfall_orchard", equipment("duskfall_helmet", "Duskfall Antlers", "HEAD", 200, 220), 1, 125),
  neon_bow: drop("neon_bastion", equipment("neon_bow", "Neon Arc Bow", "HAND", 220, 0), 1, 200),
  neon_armor: drop("neon_bastion", equipment("neon_armor", "Neon Bastion Armor", "CHEST", 220, 220), 7, 1000),
  neon_helmet: drop("neon_bastion", equipment("neon_helmet", "Neon Crest", "HEAD", 220, 240), 1, 125),
  verdant_bow: drop("verdant_catacombs", equipment("verdant_bow", "Bonewing Bow", "HAND", 240, 0), 1, 200),
  verdant_armor: drop("verdant_catacombs", equipment("verdant_armor", "Catacomb Mantle", "CHEST", 240, 240), 7, 1000),
  verdant_helmet: drop("verdant_catacombs", equipment("verdant_helmet", "Catacomb Skullhelm", "HEAD", 240, 260), 1, 125),
  ion_bow: drop("ion_citadel", equipment("ion_bow", "Ion Sovereign Bow", "HAND", 260, 0), 1, 200),
  ion_armor: drop("ion_citadel", equipment("ion_armor", "Ion Sovereign Armor", "CHEST", 260, 260), 7, 1000),
  ion_helmet: drop("ion_citadel", equipment("ion_helmet", "Ion Sovereign Helmet", "HEAD", 260, 280), 1, 125),
} as const;

export type CampaignItemId = keyof typeof CAMPAIGN_EQUIPMENT;
export const CAMPAIGN_ITEM_DEFINITIONS = Object.fromEntries(
  Object.entries(CAMPAIGN_EQUIPMENT).map(([id, entry]) => [id, entry.definition]),
) as { [Id in CampaignItemId]: ItemDefinition & { id: Id } };
