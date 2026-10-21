import { DOM_SCENES } from "./scenes-dom";
import { WORLD_SCENES } from "./scenes-world";
import { combatHits } from "./scenes-combat";
import { forest, town, world } from "./scenes-map";
import { bosses } from "./scenes-bosses";
import { guildBattlefield } from "./scenes-guild";

/** Every scene, by its URL hash. capture.mjs reads the list from the page. */
export const SCENES: Record<string, () => Promise<void>> = { ...WORLD_SCENES, "combat-hits": combatHits, world, town, forest, bosses, "guild-battlefield": guildBattlefield, ...DOM_SCENES };
