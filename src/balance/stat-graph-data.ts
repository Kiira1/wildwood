import { generateMap, isProceduralMap } from "../../shared/procedural-maps";

import { BOSS_DAMAGE_PROFILES } from "../game/boss-damage";
import { ENEMY_TYPES, type EnemyDefinition, type EnemyKind } from "../game/enemies";
import {
  ADVANCED_LAVA_WASTES_MAP_ID,
  BEGINNER_DESERT_MAP_ID,
  CLOUDSPIRE_MAP_ID,
  createSpawnSites,
  CRYSTAL_HOLLOWS_MAP_ID, CLOCKWORK_RUINS_MAP_ID, DUSKFALL_ORCHARD_MAP_ID, NEON_BASTION_MAP_ID, VERDANT_CATACOMBS_MAP_ID, ION_CITADEL_MAP_ID,
  INFERNAL_DEPTHS_MAP_ID,
  INTERMEDIATE_SNOWLANDS_MAP_ID,
  MOONFEN_MAP_ID,
  mapSpawnCamps,
  SAMURAI_GARDEN_MAP_ID,
  TUTORIAL_FOREST_MAP_ID,
  WATER_REACH_MAP_ID,
  type MapId,
} from "../game/world";
import {
  DRAGON_MAX_HP,
  DRAGON_REWARD_DAMAGE,
  FROSTCLAW_MAX_HP,
  FROSTCLAW_REWARD_ARMOR,
  FROSTCLAW_REWARD_DAMAGE,
  FROSTCLAW_REWARD_HEALTH,
  GLOOMROOT_MAX_HP,
  GLOOMROOT_REWARD_ARMOR,
  GLOOMROOT_REWARD_DAMAGE,
  GLOOMROOT_REWARD_HEALTH,
  GLOOMROOT_REWARD_REGEN,
  KOI_SHOGUN_MAX_HP,
  KOI_SHOGUN_REWARD_ARMOR,
  KOI_SHOGUN_REWARD_DAMAGE,
  KOI_SHOGUN_REWARD_HEALTH,
  KOI_SHOGUN_REWARD_REGEN,
  MAGMALISK_MAX_HP,
  MAGMALISK_REWARD_ARMOR,
  MAGMALISK_REWARD_DAMAGE,
  MAGMALISK_REWARD_HEALTH,
  MAGMALISK_REWARD_REGEN,
  MAP_DISPLAY_NAMES,
  MIREMAW_MAX_HP,
  MIREMAW_REWARD_ARMOR,
  MIREMAW_REWARD_DAMAGE,
  MIREMAW_REWARD_HEALTH,
  MIREMAW_REWARD_REGEN,
  PRISMSHELL_MAX_HP, IRONHORN_MAX_HP, DREADREAPER_MAX_HP, VOLTWARDEN_MAX_HP, GRAVEBLOOM_MAX_HP, AEGIS_PRIME_MAX_HP,
  PRISMSHELL_REWARD_ARMOR, IRONHORN_REWARD_ARMOR, DREADREAPER_REWARD_ARMOR, VOLTWARDEN_REWARD_ARMOR, GRAVEBLOOM_REWARD_ARMOR, AEGIS_PRIME_REWARD_ARMOR,
  PRISMSHELL_REWARD_DAMAGE, IRONHORN_REWARD_DAMAGE, DREADREAPER_REWARD_DAMAGE, VOLTWARDEN_REWARD_DAMAGE, GRAVEBLOOM_REWARD_DAMAGE, AEGIS_PRIME_REWARD_DAMAGE,
  PRISMSHELL_REWARD_HEALTH, IRONHORN_REWARD_HEALTH, DREADREAPER_REWARD_HEALTH, VOLTWARDEN_REWARD_HEALTH, GRAVEBLOOM_REWARD_HEALTH, AEGIS_PRIME_REWARD_HEALTH,
  PRISMSHELL_REWARD_REGEN, IRONHORN_REWARD_REGEN, DREADREAPER_REWARD_REGEN, VOLTWARDEN_REWARD_REGEN, GRAVEBLOOM_REWARD_REGEN, AEGIS_PRIME_REWARD_REGEN,
  SPIDER_MAX_HP,
  SPIDER_REWARD_DAMAGE,
  SPIDER_REWARD_HEALTH,
  TEMPEST_KIRIN_MAX_HP,
  TEMPEST_KIRIN_REWARD_ARMOR,
  TEMPEST_KIRIN_REWARD_DAMAGE,
  TEMPEST_KIRIN_REWARD_HEALTH,
  TEMPEST_KIRIN_REWARD_REGEN,
  TIDEWYRM_MAX_HP,
  TIDEWYRM_REWARD_ARMOR,
  TIDEWYRM_REWARD_DAMAGE,
  TIDEWYRM_REWARD_HEALTH,
  TIDEWYRM_REWARD_REGEN,
} from "../../shared/rules";

type RewardStat = "damage" | "health" | "armor" | "regen";
type MetricGroup = "combat" | "rewards";
type BossKind = keyof typeof BOSS_DAMAGE_PROFILES;

export type StatGraphMetricKey =
  | "regularHealth"
  | "regularDamage"
  | "bossHealth"
  | "bossHeavyHit"
  | "regularRewardDamage1"
  | "regularRewardDamage2"
  | "regularRewardDamage3"
  | "regularRewardHealth1"
  | "regularRewardHealth2"
  | "regularRewardArmor1"
  | "regularRewardRegen1"
  | "bossRewardDamage"
  | "bossRewardHealth"
  | "bossRewardArmor"
  | "bossRewardRegen";

export type StatGraphMetric = {
  key: StatGraphMetricKey;
  label: string;
  group: MetricGroup;
  series: number;
  regularReward?: { stat: RewardStat; sourceIndex: number };
};

export const STAT_GRAPH_METRICS = [
  { key: "regularHealth", label: "Regular HP", group: "combat", series: 1 },
  { key: "regularDamage", label: "Regular damage / strength", group: "combat", series: 2 },
  { key: "bossHealth", label: "Boss HP", group: "combat", series: 3 },
  { key: "bossHeavyHit", label: "Boss heavy hit", group: "combat", series: 4 },
  { key: "regularRewardDamage1", label: "Regular damage reward · first", group: "rewards", series: 5, regularReward: { stat: "damage", sourceIndex: 0 } },
  { key: "regularRewardDamage2", label: "Regular damage reward · second", group: "rewards", series: 6, regularReward: { stat: "damage", sourceIndex: 1 } },
  { key: "regularRewardDamage3", label: "Regular damage reward · third", group: "rewards", series: 7, regularReward: { stat: "damage", sourceIndex: 2 } },
  { key: "regularRewardHealth1", label: "Regular health reward · first", group: "rewards", series: 8, regularReward: { stat: "health", sourceIndex: 0 } },
  { key: "regularRewardHealth2", label: "Regular health reward · second", group: "rewards", series: 9, regularReward: { stat: "health", sourceIndex: 1 } },
  { key: "regularRewardArmor1", label: "Regular armor reward", group: "rewards", series: 10, regularReward: { stat: "armor", sourceIndex: 0 } },
  { key: "regularRewardRegen1", label: "Regular regen reward", group: "rewards", series: 11, regularReward: { stat: "regen", sourceIndex: 0 } },
  { key: "bossRewardDamage", label: "Boss clear: damage", group: "rewards", series: 12 },
  { key: "bossRewardHealth", label: "Boss clear: health", group: "rewards", series: 13 },
  { key: "bossRewardArmor", label: "Boss clear: armor", group: "rewards", series: 14 },
  { key: "bossRewardRegen", label: "Boss clear: regen", group: "rewards", series: 15 },
] as const satisfies readonly StatGraphMetric[];

export type RegularRewardSource = {
  kind: EnemyKind;
  amount: number;
};

export type StatGraphRow = {
  mapId: MapId;
  name: string;
  values: Record<StatGraphMetricKey, number | null>;
  multipliers: Record<StatGraphMetricKey, number | null>;
  regularRewards: Record<RewardStat, readonly RegularRewardSource[]>;
};

type BossRewards = Partial<Record<RewardStat, number>>;
type AuthoredMap = {
  id: MapId;
  bossKind: BossKind;
  bossMaxHp: number;
  bossRewards: BossRewards;
};

export const AUTHORED_MAPS: readonly AuthoredMap[] = [
  {
    id: TUTORIAL_FOREST_MAP_ID,
    bossKind: "dragon",
    bossMaxHp: DRAGON_MAX_HP,
    bossRewards: { damage: DRAGON_REWARD_DAMAGE },
  },
  {
    id: BEGINNER_DESERT_MAP_ID,
    bossKind: "spider",
    bossMaxHp: SPIDER_MAX_HP,
    bossRewards: { damage: SPIDER_REWARD_DAMAGE, health: SPIDER_REWARD_HEALTH },
  },
  {
    id: INTERMEDIATE_SNOWLANDS_MAP_ID,
    bossKind: "frostclaw",
    bossMaxHp: FROSTCLAW_MAX_HP,
    bossRewards: {
      damage: FROSTCLAW_REWARD_DAMAGE,
      health: FROSTCLAW_REWARD_HEALTH,
      armor: FROSTCLAW_REWARD_ARMOR,
    },
  },
  {
    id: ADVANCED_LAVA_WASTES_MAP_ID,
    bossKind: "magmalisk",
    bossMaxHp: MAGMALISK_MAX_HP,
    bossRewards: {
      damage: MAGMALISK_REWARD_DAMAGE,
      health: MAGMALISK_REWARD_HEALTH,
      armor: MAGMALISK_REWARD_ARMOR,
      regen: MAGMALISK_REWARD_REGEN,
    },
  },
  {
    id: INFERNAL_DEPTHS_MAP_ID,
    bossKind: "gloomroot",
    bossMaxHp: GLOOMROOT_MAX_HP,
    bossRewards: {
      damage: GLOOMROOT_REWARD_DAMAGE,
      health: GLOOMROOT_REWARD_HEALTH,
      armor: GLOOMROOT_REWARD_ARMOR,
      regen: GLOOMROOT_REWARD_REGEN,
    },
  },
  {
    id: WATER_REACH_MAP_ID,
    bossKind: "tidewyrm",
    bossMaxHp: TIDEWYRM_MAX_HP,
    bossRewards: {
      damage: TIDEWYRM_REWARD_DAMAGE,
      health: TIDEWYRM_REWARD_HEALTH,
      armor: TIDEWYRM_REWARD_ARMOR,
      regen: TIDEWYRM_REWARD_REGEN,
    },
  },
  {
    id: SAMURAI_GARDEN_MAP_ID,
    bossKind: "koiShogun",
    bossMaxHp: KOI_SHOGUN_MAX_HP,
    bossRewards: {
      damage: KOI_SHOGUN_REWARD_DAMAGE,
      health: KOI_SHOGUN_REWARD_HEALTH,
      armor: KOI_SHOGUN_REWARD_ARMOR,
      regen: KOI_SHOGUN_REWARD_REGEN,
    },
  },
  {
    id: CLOUDSPIRE_MAP_ID,
    bossKind: "tempestKirin",
    bossMaxHp: TEMPEST_KIRIN_MAX_HP,
    bossRewards: {
      damage: TEMPEST_KIRIN_REWARD_DAMAGE,
      health: TEMPEST_KIRIN_REWARD_HEALTH,
      armor: TEMPEST_KIRIN_REWARD_ARMOR,
      regen: TEMPEST_KIRIN_REWARD_REGEN,
    },
  },
  {
    id: MOONFEN_MAP_ID,
    bossKind: "miremaw",
    bossMaxHp: MIREMAW_MAX_HP,
    bossRewards: {
      damage: MIREMAW_REWARD_DAMAGE,
      health: MIREMAW_REWARD_HEALTH,
      armor: MIREMAW_REWARD_ARMOR,
      regen: MIREMAW_REWARD_REGEN,
    },
  },
  {
    id: CRYSTAL_HOLLOWS_MAP_ID,
    bossKind: "prismshell",
    bossMaxHp: PRISMSHELL_MAX_HP,
    bossRewards: {
      damage: PRISMSHELL_REWARD_DAMAGE,
      health: PRISMSHELL_REWARD_HEALTH,
      armor: PRISMSHELL_REWARD_ARMOR,
      regen: PRISMSHELL_REWARD_REGEN,
    },
  }, {
    id: CLOCKWORK_RUINS_MAP_ID,
    bossKind: "ironhorn",
    bossMaxHp: IRONHORN_MAX_HP,
    bossRewards: {
      damage: IRONHORN_REWARD_DAMAGE,
      health: IRONHORN_REWARD_HEALTH,
      armor: IRONHORN_REWARD_ARMOR,
      regen: IRONHORN_REWARD_REGEN,
    },
  }, {
    id: DUSKFALL_ORCHARD_MAP_ID,
    bossKind: "dreadreaper",
    bossMaxHp: DREADREAPER_MAX_HP,
    bossRewards: {
      damage: DREADREAPER_REWARD_DAMAGE,
      health: DREADREAPER_REWARD_HEALTH,
      armor: DREADREAPER_REWARD_ARMOR,
      regen: DREADREAPER_REWARD_REGEN,
    },
  }, {
    id: NEON_BASTION_MAP_ID,
    bossKind: "voltwarden",
    bossMaxHp: VOLTWARDEN_MAX_HP,
    bossRewards: {
      damage: VOLTWARDEN_REWARD_DAMAGE,
      health: VOLTWARDEN_REWARD_HEALTH,
      armor: VOLTWARDEN_REWARD_ARMOR,
      regen: VOLTWARDEN_REWARD_REGEN,
    },
  }, {
    id: VERDANT_CATACOMBS_MAP_ID,
    bossKind: "gravebloom",
    bossMaxHp: GRAVEBLOOM_MAX_HP,
    bossRewards: {
      damage: GRAVEBLOOM_REWARD_DAMAGE,
      health: GRAVEBLOOM_REWARD_HEALTH,
      armor: GRAVEBLOOM_REWARD_ARMOR,
      regen: GRAVEBLOOM_REWARD_REGEN,
    },
  }, {
    id: ION_CITADEL_MAP_ID,
    bossKind: "aegisPrime",
    bossMaxHp: AEGIS_PRIME_MAX_HP,
    bossRewards: {
      damage: AEGIS_PRIME_REWARD_DAMAGE,
      health: AEGIS_PRIME_REWARD_HEALTH,
      armor: AEGIS_PRIME_REWARD_ARMOR,
      regen: AEGIS_PRIME_REWARD_REGEN,
    },
  },
];

function weightedAverage(
  entries: readonly { value: number; weight: number }[],
): number | null {
  const totalWeight = entries.reduce((total, entry) => total + entry.weight, 0);
  if (totalWeight <= 0) return null;
  return entries.reduce((total, entry) => total + entry.value * entry.weight, 0) / totalWeight;
}

function regularMapStats(mapId: MapId) {
  const counts = new Map<EnemyKind, number>();
  for (const site of createSpawnSites({ x: 4050, y: 4050 }, mapId)) {
    counts.set(site.type, (counts.get(site.type) ?? 0) + 1);
  }

  const entries = (read: (enemy: EnemyDefinition) => number) =>
    [...counts.entries()].map(([kind, weight]) => ({ value: read(ENEMY_TYPES[kind]), weight }));

  return {
    health: weightedAverage(entries((enemy) => enemy.hp)),
    damage: weightedAverage(entries((enemy) => enemy.damage)),
  };
}

function regularMapRewardSources(mapId: MapId): Record<RewardStat, RegularRewardSource[]> {
  const sources: Record<RewardStat, RegularRewardSource[]> = {
    damage: [], health: [], armor: [], regen: [],
  };
  const includedKinds = new Set<EnemyKind>();
  for (const camp of mapSpawnCamps(mapId)) {
    for (const kind of camp.types) {
      if (includedKinds.has(kind)) continue;
      includedKinds.add(kind);
      // Spitter is onboarding-only. It is intentionally excluded from the
      // campaign progression view, whose first damage source is Cindermaw.
      if (kind === "Spitter") continue;
      const enemy = ENEMY_TYPES[kind];
      if (enemy.reward.type === "speed") continue;
      sources[enemy.reward.type].push({ kind, amount: enemy.reward.amount });
    }
  }
  return sources;
}

function bossHeavyHit(kind: BossKind) {
  return Math.max(...(Object.values(BOSS_DAMAGE_PROFILES[kind]) as number[]));
}

function mapValues(
  map: AuthoredMap,
  regularRewards: Record<RewardStat, readonly RegularRewardSource[]>,
): StatGraphRow["values"] {
  const regular = regularMapStats(map.id);
  return {
    regularHealth: regular.health,
    regularDamage: regular.damage,
    bossHealth: map.bossMaxHp,
    bossHeavyHit: bossHeavyHit(map.bossKind),
    regularRewardDamage1: regularRewards.damage[0]?.amount ?? null,
    regularRewardDamage2: regularRewards.damage[1]?.amount ?? null,
    regularRewardDamage3: regularRewards.damage[2]?.amount ?? null,
    regularRewardHealth1: regularRewards.health[0]?.amount ?? null,
    regularRewardHealth2: regularRewards.health[1]?.amount ?? null,
    regularRewardArmor1: regularRewards.armor[0]?.amount ?? null,
    regularRewardRegen1: regularRewards.regen[0]?.amount ?? null,
    bossRewardDamage: map.bossRewards.damage ?? null,
    bossRewardHealth: map.bossRewards.health ?? null,
    bossRewardArmor: map.bossRewards.armor ?? null,
    bossRewardRegen: map.bossRewards.regen ?? null,
  };
}

function mapMultipliers(
  values: StatGraphRow["values"],
  previous: StatGraphRow["values"] | null,
): StatGraphRow["multipliers"] {
  const multipliers = {} as StatGraphRow["multipliers"];
  for (const metric of STAT_GRAPH_METRICS) {
    const current = values[metric.key];
    const prior = previous?.[metric.key] ?? null;
    multipliers[metric.key] = current !== null && prior !== null && prior !== 0
      ? current / prior
      : null;
  }
  return multipliers;
}

export const AUTHORED_STAT_GRAPH: readonly StatGraphRow[] = (() => {
  let previous: StatGraphRow["values"] | null = null;
  return AUTHORED_MAPS.map((map) => {
    const regularRewards = regularMapRewardSources(map.id);
    const values = mapValues(map, regularRewards);
    const row: StatGraphRow = {
      mapId: map.id,
      name: isProceduralMap(map.id) ? generateMap(map.id).name : MAP_DISPLAY_NAMES[map.id],
      values,
      multipliers: mapMultipliers(values, previous),
      regularRewards,
    };
    previous = values;
    return row;
  });
})();
