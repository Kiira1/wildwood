import { CAMPAIGN_ITEM_DEFINITIONS } from "./campaign-equipment";

// Browser- and server-safe equipment catalog. Add gameplay-facing item data
// here; client-only sprites and draw anchors live in item-presentation.ts.

export const WOODEN_SWORD = "wooden_sword";
export const BASIC_PAPER_HAT = "basic_paper_hat";
export const SUPERIOR_GOLDEN_HELMET = "superior_golden_helmet";
export const WOOD_FULL_HELM = "wood_full_helm";
export const FIRE_METAL_HELMET = "fire_metal_helmet";
export const DARK_METAL_HELMET = "dark_metal_helmet";
export const CLOUDSPIRE_ARMOR = "cloudspire_armor";
export const MOONFEN_ARMOR = "moonfen_armor";
export const CLOUDSPIRE_BOW = "cloudspire_bow";
export const CLOUDSPIRE_HELMET = "cloudspire_helmet";
export const SKY_BOW = "sky_bow";
export const SKY_BOW_DROP_NUMERATOR = 7;
export const SKY_BOW_DROP_DENOMINATOR = 1_000; // Exactly 0.7%, independently of armor.
export const WATER_ARMOR = "water_armor";
export const WATER_ARMOR_DROP_DENOMINATOR = 100; // 1% per regular Water Reach enemy.
export const SAMURAI_BOW = "samurai_bow";
export const SAMURAI_BOW_DROP_NUMERATOR = 13;
export const SAMURAI_BOW_DROP_DENOMINATOR = 2_000; // Exactly 0.65%, independently of the helmet.
export const SAMURAI_HAT = "samurai_hat";
export const LEGENDARY_WHITE_GOLD_ARMOR = "legendary_white_gold_armor";
export const BLACK_BOOTS = "black_boots";
export const BLACK_BOOTS_DROP_DENOMINATOR = 50;
export const BLACK_BOOTS_SPEED_BONUS = 25;
export const BLACK_BOOTS_COMBAT_DELAY_MS = 5_000;
export const TRAILBLAZER_BOOTS = "trailblazer_boots";
export const STARTER_STONE = "starter_stone";
export const STARTER_BOW = "starter_bow";
export const IRON_BOW = "iron_bow";
export const SNOW_BOW = "snow_bow";
export const FROST_BOW = "frost_bow";
export const LAVA_BOW = "lava_bow";
export const NIGHT_BOW = "night_bow";
export const FIRE_METAL_BOW = "fire_metal_bow";
export const FROST_ARMOR = "frost_armor";
export const MAGMA_ARMOR = "magma_armor";
export const WOODEN_ARMOR = "wooden_armor";
export const FOREST_ITEM_DROP_DENOMINATOR = 25;
export const DESERT_ITEM_DROP_DENOMINATOR = 50;
export const SNOW_ITEM_DROP_DENOMINATOR = 50;
// Per-enemy odds match the later-map equipment range, independent of kill batching.
export const LAVA_ITEM_DROP_NUMERATOR = 7;
export const LAVA_ITEM_DROP_DENOMINATOR = 1_000; // Magma Armor: 0.7%.
export const LAVA_HELMET_ITEM_DROP_DENOMINATOR = 125; // Fire Metal Helmet: 0.8%.
export const LAVA_BOSS_ITEM_DROP_DENOMINATOR = 25;
export const INFERNAL_ITEM_DROP_DENOMINATOR = 200; // Fire Metal Bow: 0.5%.
export const NIGHT_FOREST_BOW_ITEM_DROP_DENOMINATOR = 100;
export const NIGHT_FOREST_HELMET_ITEM_DROP_DENOMINATOR = 125; // Dark Metal Helmet: 0.8%.
export const SAMURAI_HAT_ITEM_DROP_DENOMINATOR = 125; // 0.8% per regular Samurai Gardens enemy.
export const SNOW_BOSS_ITEM_DROP_DENOMINATOR = 25;
export const SNOW_BOSS_ARMOR_DROP_DENOMINATOR = 5;
export const MAX_OWNED_ITEM_COUNT = 1;
// Kept as a compatibility export for older client/server call sites. Wildstat
// equipment is unique now, so every durable quantity is clamped to one.
export const MAX_FOREST_ITEM_COUNT = MAX_OWNED_ITEM_COUNT;
export const MAX_ITEM_UPGRADE_LEVEL = 10;
// Each level adds this share of the item's level-zero bonus.
export const ITEM_UPGRADE_STAT_BONUS = .08;
export const ITEM_UPGRADE_BASE_DURATION_MS = 3 * 60 * 1_000;
export const ITEM_UPGRADE_DURATION_GROWTH = 1.4;

export type ItemSlot = "HEAD" | "CHEST" | "FEET" | "HAND";
export type EquipmentSlot = "HEAD" | "CHEST" | "FEET" | "RIGHT_HAND" | "LEFT_HAND";
export type ItemAcquisition = "STARTER" | "PROGRESSION" | "DEVELOPER" | "FOREST_DROP" | "DESERT_DROP" | "SNOW_DROP" | "SNOW_BOSS_DROP" | "LAVA_DROP" | "LAVA_BOSS_DROP" | "INFERNAL_DROP" | "SAMURAI_DROP" | "WATER_DROP" | "CLOUDSPIRE_DROP" | "MOONFEN_DROP" | "CAMPAIGN_DROP";
export type ProjectileKind = "ROCK" | "ARROW";

export type ItemDefinition = {
  id: string;
  name: string;
  slot: ItemSlot;
  acquisition: ItemAcquisition;
  description: string;
  stats: readonly string[];
  cosmeticOnly?: boolean;
  modifiers?: {
    damageBonus?: number;
    maxHealthBonus?: number;
    regenerationBonus?: number;
  };
  weapon?: {
    mode: "RANGED" | "MELEE";
    projectile?: ProjectileKind;
    range?: number;
    damageBonus?: number;
  };
};

export const ITEM_DEFINITIONS = {
  ...CAMPAIGN_ITEM_DEFINITIONS,
  [WOODEN_SWORD]: {
    id: WOODEN_SWORD, name: "WOODEN SWORD", slot: "HAND", acquisition: "DEVELOPER",
    description: "A simple wooden practice sword for close-range combat.",
    stats: ["MELEE · 75 RANGE"],
    weapon: { mode: "MELEE", range: 75 },
  },
  [BASIC_PAPER_HAT]: {
    id: BASIC_PAPER_HAT,
    cosmeticOnly: true,
    name: "BASIC PAPER HAT",
    slot: "HEAD",
    acquisition: "STARTER",
    description: "A folded brown paper hat. No stats, just style.",
    stats: ["NO STATS"],
  },
  [SUPERIOR_GOLDEN_HELMET]: {
    id: SUPERIOR_GOLDEN_HELMET,
    cosmeticOnly: true,
    name: "ALPHA TESTER HELMET",
    slot: "HEAD",
    acquisition: "DEVELOPER",
    description: "A gleaming winged helmet for Wildstat alpha testers.",
    stats: ["COSMETIC · NO STATS"],
  },
  [WOOD_FULL_HELM]: {
    id: WOOD_FULL_HELM,
    name: "WOOD FULL HELM",
    slot: "HEAD",
    acquisition: "DESERT_DROP",
    description: "A sturdy wooden full helm carried by Beginner Desert monsters that increases maximum health.",
    stats: ["MAX HEALTH +400"],
    modifiers: { maxHealthBonus: 400 },
  },
  [FIRE_METAL_HELMET]: {
    id: FIRE_METAL_HELMET,
    name: "FIRE METAL HELMET",
    slot: "HEAD",
    acquisition: "LAVA_DROP",
    description: "A red-hot metal helm carried by Advanced Lava Lake monsters that fortifies health and regeneration.",
    stats: ["MAX HEALTH +3600", "REGEN +108"],
    modifiers: {
      maxHealthBonus: 3600,
      regenerationBonus: 108,
    },
  },
  [DARK_METAL_HELMET]: {
    id: DARK_METAL_HELMET,
    name: "DARK METAL HELMET",
    slot: "HEAD",
    acquisition: "INFERNAL_DROP",
    description: "A horned dark-metal helm carried by Night Forest monsters that greatly amplifies health and regeneration.",
    stats: ["MAX HEALTH +10800", "REGEN +324"],
    modifiers: {
      maxHealthBonus: 10800,
      regenerationBonus: 324,
    },
  },
  [SAMURAI_HAT]: {
    id: SAMURAI_HAT,
    name: "SAMURAI HAT",
    slot: "HEAD",
    acquisition: "SAMURAI_DROP",
    description: "A crimson samurai helmet carried by Samurai Gardens monsters that strengthens health and regeneration.",
    stats: ["MAX HEALTH +97200", "REGEN +2916"],
    modifiers: { maxHealthBonus: 97200, regenerationBonus: 2916 },
  },
  [LEGENDARY_WHITE_GOLD_ARMOR]: {
    id: LEGENDARY_WHITE_GOLD_ARMOR,
    cosmeticOnly: true,
    name: "LEGENDARY WHITE GOLD ARMOR",
    slot: "CHEST",
    acquisition: "DEVELOPER",
    description: "White gold plate with a legendary gleam. Cosmetic only.",
    stats: ["COSMETIC · NO STATS"],
  },
  [TRAILBLAZER_BOOTS]: {
    id: TRAILBLAZER_BOOTS,
    cosmeticOnly: true,
    name: "TRAILBLAZER BOOTS",
    slot: "FEET",
    acquisition: "PROGRESSION",
    description: "Your starting leather boots. No stats, just style.",
    stats: ["COSMETIC · NO STATS"],
  },
  [BLACK_BOOTS]: {
    id: BLACK_BOOTS,
    name: "BLACK BOOTS",
    slot: "FEET",
    acquisition: "INFERNAL_DROP",
    description: "Quiet boots from Night Forest. Speed returns after 5 seconds without attacking or taking a hit.",
    stats: ["OUT OF COMBAT MOVE SPEED +25", "REACTIVATES AFTER 5 SECONDS"],
  },
  [STARTER_STONE]: {
    id: STARTER_STONE,
    name: "STARTER STONE",
    slot: "HAND",
    acquisition: "STARTER",
    description: "Your trusty first throwing stone.",
    stats: ["STARTER WEAPON · NO STATS"],
    weapon: { mode: "RANGED", projectile: "ROCK" },
  },
  [STARTER_BOW]: {
    id: STARTER_BOW,
    name: "BOW",
    slot: "HAND",
    acquisition: "FOREST_DROP",
    description: "A dependable wooden bow for hunting Wildstat monsters.",
    stats: ["DAMAGE +5"],
    weapon: {
      mode: "RANGED",
      projectile: "ARROW",
      damageBonus: 5,
    },
  },
  [IRON_BOW]: {
    id: IRON_BOW,
    name: "IRON BOW",
    slot: "HAND",
    acquisition: "DESERT_DROP",
    description: "A reinforced iron bow carried by Beginner Desert monsters that strengthens every shot.",
    stats: ["DAMAGE +480"],
    weapon: {
      mode: "RANGED",
      projectile: "ARROW",
      damageBonus: 480,
    },
  },
  [SNOW_BOW]: {
    id: SNOW_BOW,
    name: "SNOW BOW",
    slot: "HAND",
    acquisition: "SNOW_DROP",
    description: "A white bow carried by Snowlands monsters, balanced as a stepping stone toward Frostclaw's weapon.",
    stats: ["DAMAGE +1440"],
    weapon: {
      mode: "RANGED",
      projectile: "ARROW",
      damageBonus: 1440,
    },
  },
  [FROST_BOW]: {
    id: FROST_BOW,
    name: "FROST BOW",
    slot: "HAND",
    acquisition: "SNOW_BOSS_DROP",
    description: "A frozen bow claimed from Frostclaw, built for devastating shots.",
    stats: ["DAMAGE +1728"],
    weapon: {
      mode: "RANGED",
      projectile: "ARROW",
      damageBonus: 1728,
    },
  },
  [LAVA_BOW]: {
    id: LAVA_BOW,
    name: "LAVA BOW",
    slot: "HAND",
    acquisition: "LAVA_BOSS_DROP",
    description: "A blazing red bow claimed from the Magmalisk, built for overwhelming damage.",
    stats: ["DAMAGE +5184"],
    weapon: {
      mode: "RANGED",
      projectile: "ARROW",
      damageBonus: 5184,
    },
  },
  [NIGHT_BOW]: {
    id: NIGHT_BOW,
    name: "NIGHT BOW",
    slot: "HAND",
    acquisition: "INFERNAL_DROP",
    description: "A purple bow carried by Night Forest monsters that provides a dependable bridge to rarer Night Forest equipment.",
    stats: ["DAMAGE +12960"],
    weapon: {
      mode: "RANGED",
      projectile: "ARROW",
      damageBonus: 12960,
    },
  },
  [FIRE_METAL_BOW]: {
    id: FIRE_METAL_BOW,
    name: "FIRE METAL BOW",
    slot: "HAND",
    acquisition: "INFERNAL_DROP",
    description: "A forged bow carried by Night Forest monsters, built for extreme damage.",
    stats: ["DAMAGE +15552"],
    weapon: {
      mode: "RANGED",
      projectile: "ARROW",
      damageBonus: 15552,
    },
  },
  [FROST_ARMOR]: {
    id: FROST_ARMOR,
    name: "FROST ARMOR",
    slot: "CHEST",
    acquisition: "SNOW_BOSS_DROP",
    description: "Frozen blue armor claimed from Frostclaw that fortifies health and regeneration.",
    stats: ["MAX HEALTH +1440", "REGEN +43.2"],
    modifiers: {
      maxHealthBonus: 1440,
      regenerationBonus: 43.2,
    },
  },
  [CLOUDSPIRE_ARMOR]: {
    id: CLOUDSPIRE_ARMOR,
    name: "CLOUDSPIRE ARMOR",
    slot: "CHEST",
    acquisition: "CLOUDSPIRE_DROP",
    description: "Golden armor carried by Cloudspire monsters that strengthens health and regeneration.",
    stats: ["MAX HEALTH +291600", "REGEN +8748"],
    modifiers: { maxHealthBonus: 291600, regenerationBonus: 8748 },
  },
  [MOONFEN_ARMOR]: {
    id: MOONFEN_ARMOR,
    name: "MOONFEN ARMOR",
    slot: "CHEST",
    acquisition: "MOONFEN_DROP",
    description: "Green armor carried by Moonfen monsters that strengthens health and regeneration.",
    stats: ["MAX HEALTH +874800", "REGEN +26244"],
    modifiers: { maxHealthBonus: 874800, regenerationBonus: 26244 },
  },
  [CLOUDSPIRE_BOW]: {
    id: CLOUDSPIRE_BOW,
    name: "CLOUDSPIRE BOW",
    slot: "HAND",
    acquisition: "CLOUDSPIRE_DROP",
    description: "A golden bow carried by Cloudspire monsters that strengthens every shot.",
    stats: ["DAMAGE +349920"],
    weapon: { mode: "RANGED", projectile: "ARROW", damageBonus: 349920 },
  },
  [CLOUDSPIRE_HELMET]: {
    id: CLOUDSPIRE_HELMET,
    name: "CLOUDSPIRE HELMET",
    slot: "HEAD",
    acquisition: "CLOUDSPIRE_DROP",
    description: "A golden helmet carried by Cloudspire monsters that strengthens health and regeneration.",
    stats: ["MAX HEALTH +291600", "REGEN +8748"],
    modifiers: { maxHealthBonus: 291600, regenerationBonus: 8748 },
  },
  [SAMURAI_BOW]: {
    id: SAMURAI_BOW,
    name: "SAMURAI BOW",
    slot: "HAND",
    acquisition: "SAMURAI_DROP",
    description: "A magenta bow carried by Samurai Gardens monsters that doubles weapon damage.",
    stats: ["DAMAGE +116640"],
    weapon: { mode: "RANGED", projectile: "ARROW", damageBonus: 116640 },
  },
  [SKY_BOW]: {
    id: SKY_BOW,
    name: "SKY BOW",
    slot: "HAND",
    acquisition: "WATER_DROP",
    description: "A sky-blue bow carried by Water Reach monsters that amplifies every shot.",
    stats: ["DAMAGE +38880"],
    weapon: { mode: "RANGED", projectile: "ARROW", damageBonus: 38880 },
  },
  [WATER_ARMOR]: {
    id: WATER_ARMOR,
    name: "WATER ARMOR",
    slot: "CHEST",
    acquisition: "WATER_DROP",
    description: "Blue-gray armor carried by Water Reach monsters that strengthens health and regeneration.",
    stats: ["MAX HEALTH +32400", "REGEN +972"],
    modifiers: { maxHealthBonus: 32400, regenerationBonus: 972 },
  },
  [MAGMA_ARMOR]: {
    id: MAGMA_ARMOR,
    name: "MAGMA ARMOR",
    slot: "CHEST",
    acquisition: "LAVA_DROP",
    description: "Molten orange armor carried by Lava Wastes monsters that amplifies health and regeneration.",
    stats: ["MAX HEALTH +3600", "REGEN +108"],
    modifiers: {
      maxHealthBonus: 3600,
      regenerationBonus: 108,
    },
  },
  [WOODEN_ARMOR]: {
    id: WOODEN_ARMOR,
    name: "WOODEN ARMOR",
    slot: "CHEST",
    acquisition: "FOREST_DROP",
    description: "Wooden forest plate that reinforces its wearer with extra health.",
    stats: ["MAX HEALTH +25"],
    modifiers: { maxHealthBonus: 25 },
  },
} as const satisfies Record<string, ItemDefinition>;

export type ItemId = keyof typeof ITEM_DEFINITIONS;

/** All durable enemy/boss drops, including future map sets. */
export const EQUIPMENT_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter(item => item.acquisition.endsWith("_DROP"))
  .map(item => item.id) as ItemId[];

export const STARTER_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "STARTER")
  .map((item) => item.id) as ItemId[];
export const DEVELOPER_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "DEVELOPER")
  .map((item) => item.id) as ItemId[];
export const FOREST_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "FOREST_DROP")
  .map((item) => item.id) as ItemId[];
export const DESERT_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "DESERT_DROP")
  .map((item) => item.id) as ItemId[];
export const SNOW_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "SNOW_DROP")
  .map((item) => item.id) as ItemId[];
export const SNOW_BOSS_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "SNOW_BOSS_DROP")
  .map((item) => item.id) as ItemId[];
export const LAVA_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "LAVA_DROP")
  .map((item) => item.id) as ItemId[];
export const LAVA_BOSS_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "LAVA_BOSS_DROP")
  .map((item) => item.id) as ItemId[];
export const MOONFEN_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "MOONFEN_DROP")
  .map((item) => item.id);
export const CLOUDSPIRE_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "CLOUDSPIRE_DROP")
  .map((item) => item.id);
export const WATER_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "WATER_DROP")
  .map((item) => item.id);
export const SAMURAI_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "SAMURAI_DROP")
  .map((item) => item.id);
export const INFERNAL_DROP_ITEM_IDS = Object.values(ITEM_DEFINITIONS)
  .filter((item) => item.acquisition === "INFERNAL_DROP")
  .map((item) => item.id) as ItemId[];

export function itemDefinition(itemId: unknown): ItemDefinition | undefined {
  return typeof itemId === "string"
    ? ITEM_DEFINITIONS[itemId as ItemId]
    : undefined;
}

export function canonicalItemId(itemId: unknown): ItemId | undefined {
  if (typeof itemId !== "string") return undefined;
  return itemDefinition(itemId)?.id as ItemId | undefined;
}

/** Counts one canonical unique item in a saved inventory payload. */
export function inventoryJsonItemQuantity(inventoryJson: unknown, itemId: unknown) {
  const canonical = canonicalItemId(itemId);
  if (!canonical || typeof inventoryJson !== "string") return 0;
  try {
    const itemIds = JSON.parse(inventoryJson);
    if (!Array.isArray(itemIds)) return 0;
    return Math.min(
      MAX_FOREST_ITEM_COUNT,
      itemIds.reduce((count, savedItemId) => count + Number(canonicalItemId(savedItemId) === canonical), 0),
    );
  } catch {
    return 0;
  }
}

export function itemFitsEquipmentSlot(itemId: unknown, destination: EquipmentSlot) {
  const slot = itemDefinition(canonicalItemId(itemId))?.slot;
  return slot === "HAND"
    ? destination === "RIGHT_HAND" || destination === "LEFT_HAND"
    : slot === destination;
}

export function isWeaponItem(itemId: unknown) {
  return Boolean(itemDefinition(canonicalItemId(itemId))?.weapon);
}

export function normalizeItemUpgradeLevel(level: unknown) {
  return Number.isFinite(level)
    ? Math.max(0, Math.min(MAX_ITEM_UPGRADE_LEVEL, Math.floor(Number(level))))
    : 0;
}

export function itemUpgradeDurationMs(currentLevel: unknown) {
  const level = normalizeItemUpgradeLevel(currentLevel);
  return Math.round(ITEM_UPGRADE_BASE_DURATION_MS * ITEM_UPGRADE_DURATION_GROWTH ** level);
}

export function isUpgradeableItem(itemId: unknown) {
  const item = itemDefinition(canonicalItemId(itemId));
  if (!item || (item.slot !== "HAND" && item.slot !== "HEAD" && item.slot !== "CHEST")) return false;
  return item.weapon?.damageBonus !== undefined ||
    item.modifiers?.damageBonus !== undefined ||
    item.modifiers?.maxHealthBonus !== undefined ||
    item.modifiers?.regenerationBonus !== undefined;
}

function upgradedStatBonus(baseBonus: number, level: unknown) {
  return Math.round(baseBonus * (1 + normalizeItemUpgradeLevel(level) * ITEM_UPGRADE_STAT_BONUS) * 100) / 100;
}

export function itemDisplayName(itemId: unknown, upgradeLevel: unknown = 0) {
  const item = itemDefinition(canonicalItemId(itemId));
  if (!item) return "ITEM";
  const level = normalizeItemUpgradeLevel(upgradeLevel);
  return level > 0 ? `${item.name} +${level}` : item.name;
}

export function itemStats(itemId: unknown, upgradeLevel: unknown = 0): readonly string[] {
  const item = itemDefinition(canonicalItemId(itemId));
  if (!item || !isUpgradeableItem(item.id)) return item?.stats ?? [];
  const level = normalizeItemUpgradeLevel(upgradeLevel);
  const stats: string[] = [];
  if (item.weapon?.damageBonus !== undefined) {
    stats.push(`DAMAGE +${upgradedStatBonus(item.weapon.damageBonus, level)}`);
  }
  if (item.modifiers?.damageBonus !== undefined) {
    stats.push(`DAMAGE +${upgradedStatBonus(item.modifiers.damageBonus, level)}`);
  }
  if (item.modifiers?.maxHealthBonus !== undefined) {
    stats.push(`MAX HEALTH +${upgradedStatBonus(item.modifiers.maxHealthBonus, level)}`);
  }
  if (item.modifiers?.regenerationBonus !== undefined) {
    stats.push(`REGEN +${upgradedStatBonus(item.modifiers.regenerationBonus, level)}`);
  }
  return stats;
}

export function itemUpgradeStatChanges(itemId: unknown, currentLevel: unknown) {
  const level = normalizeItemUpgradeLevel(currentLevel);
  if (!isUpgradeableItem(itemId) || level >= MAX_ITEM_UPGRADE_LEVEL) return [];
  const current = itemStats(itemId, level);
  const next = itemStats(itemId, level + 1);
  return current.map((stat, index) => {
    const splitAt = stat.lastIndexOf(" ");
    return {
      label: splitAt >= 0 ? stat.slice(0, splitAt) : stat,
      current: splitAt >= 0 ? stat.slice(splitAt + 1) : stat,
      next: next[index]?.slice(next[index].lastIndexOf(" ") + 1) ?? "",
    };
  });
}

/** Fixed equipment amounts: neither earned stats nor research multiply these. */
export function itemDamageBonus(itemId: unknown, upgradeLevel = 0) {
  const item = itemDefinition(canonicalItemId(itemId));
  return upgradedStatBonus((item?.weapon?.damageBonus ?? 0) + (item?.modifiers?.damageBonus ?? 0), upgradeLevel);
}
export function itemMaxHealthBonus(itemId: unknown, upgradeLevel = 0) {
  return upgradedStatBonus(itemDefinition(canonicalItemId(itemId))?.modifiers?.maxHealthBonus ?? 0, upgradeLevel);
}
export function itemRegenerationBonus(itemId: unknown, upgradeLevel = 0) {
  return upgradedStatBonus(itemDefinition(canonicalItemId(itemId))?.modifiers?.regenerationBonus ?? 0, upgradeLevel);
}
export function equipmentDamageBonus(weapon: unknown, head: unknown, chest: unknown, weaponLevel = 0, headLevel = 0, chestLevel = 0) {
  return itemDamageBonus(weapon, weaponLevel) + itemDamageBonus(head, headLevel) + itemDamageBonus(chest, chestLevel);
}
export function equipmentMaxHealthBonus(head: unknown, chest: unknown, headLevel = 0, chestLevel = 0) {
  return itemMaxHealthBonus(head, headLevel) + itemMaxHealthBonus(chest, chestLevel);
}
export function equipmentRegenerationBonus(head: unknown, chest: unknown, headLevel = 0, chestLevel = 0) {
  return itemRegenerationBonus(head, headLevel) + itemRegenerationBonus(chest, chestLevel);
}
export function equipmentDamage(base: number, weapon: unknown, head: unknown, chest: unknown, researchMultiplier = 1, weaponLevel = 0, headLevel = 0, chestLevel = 0) {
  return (base + equipmentDamageBonus(weapon, head, chest, weaponLevel, headLevel, chestLevel)) * researchMultiplier;
}
export function equipmentMaxHealth(base: number, head: unknown, chest: unknown, researchMultiplier = 1, headLevel = 0, chestLevel = 0) {
  return (base + equipmentMaxHealthBonus(head, chest, headLevel, chestLevel)) * researchMultiplier;
}
export function equipmentRegeneration(base: number, head: unknown, chest: unknown, researchMultiplier = 1, headLevel = 0, chestLevel = 0) {
  return (base + equipmentRegenerationBonus(head, chest, headLevel, chestLevel)) * researchMultiplier;
}

/** Permanent unlocks and starter items are restored by inventory normalization. */
export function canDestroyEquipment(itemId: unknown) {
  const item = itemDefinition(canonicalItemId(itemId));
  return !!item && item.acquisition.endsWith("_DROP");
}

/** Explicit category: weapons without stat bonuses are still equipment. */
export function isCosmeticOnlyItem(itemId: unknown): boolean {
  return itemDefinition(itemId)?.cosmeticOnly === true;
}
