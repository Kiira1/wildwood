import type { DbConnection } from "../../module_bindings";
import { createOfflineProgressPreference } from "./offline-progress-watch";
import { createBowSkills } from "./bow-skills";
import { createAdGemReward } from "./ad-gem-reward";
import { createChatMute } from "./chat-mute";
import { createSoulDimensionRows } from "./soul-dimension-service";
import { createGuildHallRows } from "./guild-hall-service";
import { createItemRefineRows } from "./item-refine-service";
import { createMiningRows } from "./mining-service";
import { createWoodcuttingRows } from "./woodcutting-service";
import { createCardRows } from "./card-service";
import { createCardShopRows } from "./card-shop-service";
import { createBuildRows } from "./build-service";
import { createWeaponMasteryRows } from "./weapon-mastery-service";
import { createGoldRows } from "./gold-service";
import { createCraftingRows } from "./crafting-service";
import { createItemCollectionRows } from "./item-collection-service";
import { itemLevelParts, type ItemLevel } from "../../../shared/items";
import { NO_CARDS, cardStatFactors, cardTotals, type CardTotals } from "../../../shared/card-effects";
import { BASE_CARD_SLOTS, activeCardsInPlay, type ActiveCardSlots, type ActiveCards } from "../../../shared/active-cards";

/**
 * The account's own small rows, each read through a caller-scoped view and
 * followed for as long as the connection is current: the offline-progress
 * opt-out, the bow skill rolls with their copies and loot settings, the
 * rewarded ad's Gem claims, the automatic chat mute and the Soul Dimension's
 * rows (soul stats, kills by reward type, whether it is open) and the guild
 * hall's fund and levels, each item's refine with the ores it costs, mining, woodcutting, cards, the Card Seller's buys, Weapon Mastery, gold and crafting. They share one
 * lifecycle, so the connection starts them together and the coop API serves
 * them together.
 */
export function createAccountRowServices(connection: () => DbConnection | null, notify: () => void, slotTierFor: (itemId: string) => number = () => 0,
  /** Active card slots of each type in play (Card Slots perks). */
  cardSlots: () => ActiveCardSlots = () => BASE_CARD_SLOTS) {
  const offlinePreference = createOfflineProgressPreference(connection, notify);
  const bowSkills = createBowSkills(notify);
  const adGemReward = createAdGemReward(notify);
  const chatMute = createChatMute(notify);
  const soulDimension = createSoulDimensionRows(connection, notify);
  const guildHall = createGuildHallRows(connection, notify);
  const itemRefine = createItemRefineRows(notify, slotTierFor);
  const mining = createMiningRows(notify);
  const woodcutting = createWoodcuttingRows(notify);
  const cards = createCardRows(notify);
  const cardShop = createCardShopRows(notify);
  const builds = createBuildRows(notify);
  const weaponMastery = createWeaponMasteryRows(notify);
  const gold = createGoldRows(notify);
  const crafting = createCraftingRows(notify);
  const collection = createItemCollectionRows(notify);
  // The active cards in play, added up again only when the cards or the slots are replaced (read many times a frame).
  let activeFrom: ActiveCards | null = null, activeSlots: ActiveCardSlots | null = null;
  let active: { ids: readonly string[]; totals: CardTotals; stats: ReturnType<typeof cardStatFactors> } = { ids: [], totals: NO_CARDS, stats: cardStatFactors(NO_CARDS) };
  const activeCards = () => {
    const from = cards.api.activeCards(), slots = cardSlots();
    if (from === activeFrom && slots === activeSlots) return active;
    activeFrom = from; activeSlots = slots;
    const ids = activeCardsInPlay(from, slots);
    if (ids.join(",") !== active.ids.join(",")) {
      const totals = cardTotals(ids);
      active = { ids, totals, stats: cardStatFactors(totals) };
    }
    return active;
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
      woodcutting.watch(current, isCurrent);
      cards.watch(current, isCurrent);
      cardShop.watch(current, isCurrent);
      builds.watch(current, isCurrent);
      weaponMastery.watch(current, isCurrent);
      gold.watch(current, isCurrent);
      crafting.watch(current, isCurrent);
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
      ...woodcutting.api,
      ...cards.api,
      ...cardShop.api,
      ...builds.api,
      ...weaponMastery.api,
      ...gold.api,
      ...crafting.api,
      ...collection.api,
      /** An item's slot tier and refine (items.ts ItemLevel). */
      itemLevel: (itemId: string): ItemLevel => itemLevelParts(itemRefine.api.itemLevel(itemId)),
      /** The active card slots of each type in play. */
      cardSlots,
      /** The active cards that count now: each type's first slots in play. */
      activeCardIds: () => activeCards().ids,
      /** Those cards added up (card-effects.ts). */
      activeCardTotals: () => activeCards().totals,
      /** What they do to stats (card-effects.ts cardStatFactors). */
      activeCardStats: () => activeCards().stats,
    },
  };
}
