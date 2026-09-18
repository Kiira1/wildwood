import { generateMap, mapRandom, type ProceduralMapId } from "./procedural-maps";
import type { EnemyKind } from "./enemy-definitions";
// A bounded pool of existing art. Only this map's selected sprites are loaded.
export const GENERATED_ENEMY_ART: readonly EnemyKind[] = [
  "Bramble",
  "Needle",
  "Mossback",
  "Spitter",
  "Brood",
  "Cindermaw",
  "Dune Raider",
  "Frost Raider",
  "Ember Raider",
  "Sakura Ronin",
  "Gale Prowler",
  "Fen Prowler",
  "Shard Hopper",
  "Gear Prowler",
  "Gourd Prowler",
  "Ion Patrol",
];
export function generatedEnemyArt(id: ProceduralMapId): EnemyKind {
  const map = generateMap(id);
  const random = mapRandom(map.seed ^ 0x34ac913);
  return GENERATED_ENEMY_ART[Math.floor(random() * GENERATED_ENEMY_ART.length)];
}
