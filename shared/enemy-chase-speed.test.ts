import { expect, it } from "vitest";
import { campaignMeleeChaseSpeed, ENEMY_TYPES, type EnemyKind } from "./enemy-definitions";
import * as camps from "./enemy-camps";
import designs from "../src/game/map-designs.json";

it("keeps early enemies approachable and ramps later-map speed to a fixed cap", () => {
  expect(ENEMY_TYPES.Bramble.speed).toBe(205);
  expect(ENEMY_TYPES["Dune Raider"].speed).toBe(205);
  expect(ENEMY_TYPES["Frost Raider"].speed).toBe(230);
  expect(campaignMeleeChaseSpeed(11)).toBe(260);
  expect(campaignMeleeChaseSpeed(100)).toBe(275);
});

it.each([
  ["duskfall_orchard", camps.DUSKFALL_ORCHARD_CAMPS],
  ["neon_bastion", camps.NEON_BASTION_CAMPS],
  ["verdant_catacombs", camps.VERDANT_CATACOMBS_CAMPS],
  ["ion_citadel", camps.ION_CITADEL_CAMPS],
] as const)("at least half of %s's actual spawns can catch a 252-speed player", (id, fallback) => {
  const saved = (designs.maps as Record<string, { status: string; spawnCamps: camps.SpawnCamp[] }>)[id];
  const rows = saved?.status === "live" && saved.spawnCamps.length ? saved.spawnCamps : fallback;
  const enemies = rows.flatMap(camp => Array.from({ length: camp.count }, (_, index) => ENEMY_TYPES[camp.types[index % camp.types.length] as EnemyKind]));
  expect(enemies.filter(enemy => !enemy.ranged && enemy.speed > 252 && enemy.speed <= 275).length).toBeGreaterThanOrEqual(enemies.length / 2);
});
