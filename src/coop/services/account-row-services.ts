import type { DbConnection } from "../../module_bindings";
import { createOfflineProgressPreference } from "./offline-progress-watch";
import { createBowSkills } from "./bow-skills";
import { createAdGemReward } from "./ad-gem-reward";
import { createChatMute } from "./chat-mute";
import { createSoulDimensionRows } from "./soul-dimension-service";
import { createGuildHallRows } from "./guild-hall-service";
import { createItemRefineRows } from "./item-refine-service";

/**
 * The account's own small rows, each read through a caller-scoped view and
 * followed for as long as the connection is current: the offline-progress
 * opt-out, the bow skill rolls with their copies and loot settings, the
 * rewarded ad's Gem claims, the automatic chat mute and the Soul Dimension's
 * rows (soul stats, kills by reward type, whether it is open) and the guild
 * hall's fund and levels, and each item's refine with the ores it costs. They share one
 * lifecycle, so the connection starts them together and the coop API serves
 * them together.
 */
export function createAccountRowServices(connection: () => DbConnection | null, notify: () => void, slotTierFor: (itemId: string) => number = () => 0) {
  const offlinePreference = createOfflineProgressPreference(connection, notify);
  const bowSkills = createBowSkills(notify);
  const adGemReward = createAdGemReward(notify);
  const chatMute = createChatMute(notify);
  const soulDimension = createSoulDimensionRows(connection, notify);
  const guildHall = createGuildHallRows(connection, notify);
  const itemRefine = createItemRefineRows(notify, slotTierFor);
  return {
    watch(current: DbConnection, isCurrent: () => boolean) {
      offlinePreference.watch(current, isCurrent);
      bowSkills.watch(current, isCurrent);
      adGemReward.watch(current, isCurrent);
      chatMute.watch(current, isCurrent);
      soulDimension.watch(current, isCurrent);
      guildHall.watch(current, isCurrent);
      itemRefine.watch(current, isCurrent);
    },
    api: {
      ...offlinePreference.api,
      ...bowSkills.api,
      ...adGemReward.api,
      ...chatMute.api,
      ...soulDimension.api,
      ...guildHall.api,
      ...itemRefine.api,
    },
  };
}
