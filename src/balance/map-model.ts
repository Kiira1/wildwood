import { resolveMapBalance } from "../../shared/map-balance";
import type { BalanceSettings } from "../../shared/map-balance-types";
import { endlessSiteLane, generateMap, isProceduralMap } from "../../shared/procedural-maps";
import type { SpawnSite } from "../game/world";
import type { BalanceMapDefinition } from "./simulator";

/** Resolve the same map contract as the game without mutating runtime catalogs. */
export function resolveSimulationMap(map: BalanceMapDefinition, settings: BalanceSettings) {
  const balance = resolveMapBalance(map.id, settings, 0);
  const boss = balance.boss;
  return { ...map, balance,
    boss: map.boss && boss ? { ...map.boss, hp: boss.hp,
      strongestHit: Math.max(boss.damage, ...Object.values(boss.attacks)),
      rewards: [],
    } : map.boss,
  };
}

export function simulationSiteDefinition(map: BalanceMapDefinition, site: SpawnSite) {
  const base = map.balance?.enemies[site.type];
  if (!base) return site.definition;
  if (!isProceduralMap(map.id)) return base;
  let index = site.id;
  for (const camp of generateMap(map.id).camps) {
    if (index < camp.count) {
      const lane = endlessSiteLane(camp, index);
      return { ...base, ...map.balance!.lanes[lane], elite: false };
    }
    index -= camp.count;
  }
  throw new Error(`Unmapped simulation spawn ${map.id}:${site.id}`);
}
