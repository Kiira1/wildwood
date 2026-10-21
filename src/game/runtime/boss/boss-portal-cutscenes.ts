import type { MapController } from "../map-controller";

type Seen = Record<"hasSeenDragonPortalCutscene" | "hasSeenSnowlandsPortalCutscene" | "hasSeenLavaPortalCutscene"
  | "hasSeenInfernalPortalCutscene" | "hasSeenWaterPortalCutscene" | "hasSeenSamuraiPortalCutscene", () => boolean>;

/** The early bosses whose first defeat plays their portal's cutscene: whether it was seen, and how to start it. */
export function bossPortalCutscenes(progression: Seen, maps: MapController) {
  return {
    dragon: { seen: progression.hasSeenDragonPortalCutscene, start: maps.startDragonPortalCutscene },
    spider: { seen: progression.hasSeenSnowlandsPortalCutscene, start: maps.startSnowlandsPortalCutscene },
    frostclaw: { seen: progression.hasSeenLavaPortalCutscene, start: maps.startLavaPortalCutscene },
    magmalisk: { seen: progression.hasSeenInfernalPortalCutscene, start: maps.startInfernalPortalCutscene },
    gloomroot: { seen: progression.hasSeenWaterPortalCutscene, start: maps.startWaterPortalCutscene },
    tidewyrm: { seen: progression.hasSeenSamuraiPortalCutscene, start: maps.startSamuraiPortalCutscene },
  };
}
