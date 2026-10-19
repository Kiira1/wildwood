import { runtimeMapBalance } from './map-balance-runtime';
import { BASIC_PAPER_HAT, PAPER_HAT_DROP_DENOMINATOR, type ItemId } from "./items";
import { TUTORIAL_FOREST_MAP_ID, REGULAR_KILL_REPORT_SECONDS } from "./rules";
// A minute at the fastest a spawn wall allows (about 5.7 kills a second) fits one report, with room: a
// speed hack's minute split over two reports was paid a little over the honest rate.
export const REGULAR_ENEMY_LOOT_BATCH_MAX = 1000;
export const REGULAR_ENEMY_LOOT_DELAY_MS = REGULAR_KILL_REPORT_SECONDS * 1000;

export type MapLootDrop = { itemId: ItemId; wins: number; outcomes: number };
/**
 * What regular enemies drop. Gear is bought at the Smith now (gear-grades.ts), so only the forest's paper hat,
 * a look with no stats, is left. Independent integer rolls keep fractional percentages exact.
 */
const LOOT: Readonly<Record<string, readonly MapLootDrop[]>> = {
  [TUTORIAL_FOREST_MAP_ID]: [{ itemId: BASIC_PAPER_HAT, wins: 1, outcomes: PAPER_HAT_DROP_DENOMINATOR }],
};
const DROPPABLE = new Set<string>(Object.values(LOOT).flatMap(drops => drops.map(drop => drop.itemId)));
/** A list without anything that no longer drops: a balance pinned before gear stopped dropping still lists it. */
export const droppableLoot = (loot: readonly MapLootDrop[]) =>
  loot.every(drop => DROPPABLE.has(drop.itemId)) ? loot : loot.filter(drop => DROPPABLE.has(drop.itemId));
export function regularMapLoot(mapId: string, authored = false): readonly MapLootDrop[] {
  const pinned = authored ? undefined : runtimeMapBalance(mapId)?.loot;
  return pinned ? droppableLoot(pinned) : LOOT[mapId] ?? [];
}
