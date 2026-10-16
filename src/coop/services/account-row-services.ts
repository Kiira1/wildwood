import type { DbConnection } from "../../module_bindings";
import { createOfflineProgressPreference } from "./offline-progress-watch";
import { createBowSkills } from "./bow-skills";
import { createAdGemReward } from "./ad-gem-reward";
import { createChatMute } from "./chat-mute";
import { createSoulDimensionRows } from "./soul-dimension-service";
import { createGuildHallRows } from "./guild-hall-service";
import { createItemRefineRows } from "./item-refine-service";
import { createMiningRows } from "./mining-service";
import { createCardRows } from "./card-service";
import { createCardShopRows } from "./card-shop-service";
import { createBuildRows } from "./build-service";
import { createItemCollectionRows } from "./item-collection-service";
import { itemLevelParts, type ItemLevel } from "../../../shared/items";
import { NO_CARDS, cardStatFactors, cardTotals, equippedCardIds, type CardTotals } from "../../../shared/card-effects";

type WornLoadout = { equippedHead?: string; equippedChest?: string; equippedRightHand?: string; equippedLeftHand?: string };

/**
 * The account's own small rows, each read through a caller-scoped view and
 * followed for as long as the connection is current: the offline-progress
 * opt-out, the bow skill rolls with their copies and loot settings, the
 * rewarded ad's Gem claims, the automatic chat mute and the Soul Dimension's
 * rows (soul stats, kills by reward type, whether it is open) and the guild
 * hall's fund and levels, each item's refine with the ores it costs, mining, cards and the Card Seller's buys. They share one
 * lifecycle, so the connection starts them together and the coop API serves
 * them together.
 */
export function createAccountRowServices(connection: () => DbConnection | null, notify: () => void, slotTierFor: (itemId: string) => number = () => 0,
  wornItems: () => WornLoadout | null | undefined = () => null) {
  const offlinePreference = createOfflineProgressPreference(connection, notify);
  const bowSkills = createBowSkills(notify);
  const adGemReward = createAdGemReward(notify);
  const chatMute = createChatMute(notify);
  const soulDimension = createSoulDimensionRows(connection, notify);
  const guildHall = createGuildHallRows(connection, notify);
  const itemRefine = createItemRefineRows(notify, slotTierFor);
  const mining = createMiningRows(notify);
  const cards = createCardRows(notify);
  const cardShop = createCardShopRows(notify);
  const builds = createBuildRows(notify);
  const collection = createItemCollectionRows(notify);
  // The saved loadout's cards, added up again only when they change.
  let wornKey = "", worn: { totals: CardTotals; stats: ReturnType<typeof cardStatFactors> } = { totals: NO_CARDS, stats: cardStatFactors(NO_CARDS) };
  const wornCards = () => {
    const ids = equippedCardIds(wornItems() ?? {}, cards.api.itemCards);
    const key = ids.join(",");
    if (key !== wornKey) {
      const totals = cardTotals(ids);
      wornKey = key;
      worn = { totals, stats: cardStatFactors(totals) };
    }
    return worn;
  };
  return {
    watch(current: DbConnection, isCurrent: () => boolean) {
      offlinePreference.watch(current, isCurrent);
      bowSkills.watch(current, isCurrent);
      adGemReward.watch(current, isCurrent);
      chatMute.watch(current, isCurrent);
      soulDimension.watch(current, isCurrent);
      guildHall.watch(current, isCurrent);
      itemRefine.watch(current, isCurrent);
      mining.watch(current, isCurrent);
      cards.watch(current, isCurrent);
      cardShop.watch(current, isCurrent);
      builds.watch(current, isCurrent);
      collection.watch(current, isCurrent);
    },
    api: {
      ...offlinePreference.api,
      ...bowSkills.api,
      ...adGemReward.api,
      ...chatMute.api,
      ...soulDimension.api,
      ...guildHall.api,
      ...itemRefine.api,
      ...mining.api,
      ...cards.api,
      ...cardShop.api,
      ...builds.api,
      ...collection.api,
      /** A worn copy's level carries its cards, which power reads (items.ts ItemLevel). */
      itemLevel: (itemId: string): ItemLevel => ({ ...itemLevelParts(itemRefine.api.itemLevel(itemId)), cards: cards.api.itemCards(itemId) }),
      /** The cards in the worn weapon, helmet and armor, added up (card-effects.ts). */
      wornCardTotals: () => wornCards().totals,
      /** What those cards do to stats (card-effects.ts cardStatFactors). */
      wornCardStats: () => wornCards().stats,
    },
  };
}
