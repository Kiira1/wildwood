import {
  WATER_ARMOR, WATER_ARMOR_DROP_DENOMINATOR, SKY_BOW, SKY_BOW_DROP_NUMERATOR, SKY_BOW_DROP_DENOMINATOR,
  SAMURAI_HAT, SAMURAI_HAT_ITEM_DROP_DENOMINATOR, SAMURAI_BOW, SAMURAI_BOW_DROP_NUMERATOR, SAMURAI_BOW_DROP_DENOMINATOR,
  CLOUDSPIRE_ARMOR, MOONFEN_ARMOR, CLOUDSPIRE_BOW, CLOUDSPIRE_HELMET, type ItemId,
} from "./items";
import { WATER_REACH_MAP_ID, SAMURAI_GARDEN_MAP_ID, CLOUDSPIRE_MAP_ID, MOONFEN_MAP_ID } from "./rules";

type Drop = { itemId: ItemId; wins: number; outcomes: number };
/** Independent integer rolls keep fractional percentages exact. */
const LOOT: Readonly<Record<string, readonly Drop[]>> = {
  [WATER_REACH_MAP_ID]: [
    { itemId: WATER_ARMOR, wins: 1, outcomes: WATER_ARMOR_DROP_DENOMINATOR },
    { itemId: SKY_BOW, wins: SKY_BOW_DROP_NUMERATOR, outcomes: SKY_BOW_DROP_DENOMINATOR },
  ],
  [SAMURAI_GARDEN_MAP_ID]: [
    { itemId: SAMURAI_HAT, wins: 1, outcomes: SAMURAI_HAT_ITEM_DROP_DENOMINATOR },
    { itemId: SAMURAI_BOW, wins: SAMURAI_BOW_DROP_NUMERATOR, outcomes: SAMURAI_BOW_DROP_DENOMINATOR },
  ],
  [CLOUDSPIRE_MAP_ID]: [
    { itemId: CLOUDSPIRE_HELMET, wins: 1, outcomes: 125 }, // 0.8%
    { itemId: CLOUDSPIRE_BOW, wins: 1, outcomes: 200 }, // 0.5%
    { itemId: CLOUDSPIRE_ARMOR, wins: 7, outcomes: 1000 }, // 0.7%
  ],
  [MOONFEN_MAP_ID]: [{ itemId: MOONFEN_ARMOR, wins: 7, outcomes: 1000 }], // 0.7%
};
export function regularMapLoot(mapId: string): readonly Drop[] { return LOOT[mapId] ?? []; }
