import type { MapController } from "../map-controller";
import {
  DRAGON_PORTAL_CUTSCENE_SEEN_KEY, INFERNAL_PORTAL_CUTSCENE_SEEN_KEY, LAVA_PORTAL_CUTSCENE_SEEN_KEY,
  SAMURAI_PORTAL_CUTSCENE_SEEN_KEY, SNOWLANDS_PORTAL_CUTSCENE_SEEN_KEY, WATER_PORTAL_CUTSCENE_SEEN_KEY,
} from "../game-settings";
import {
  ADVANCED_LAVA_WASTES_MAP_ID, BEGINNER_DESERT_MAP_ID, INFERNAL_DEPTHS_MAP_ID, INTERMEDIATE_SNOWLANDS_MAP_ID,
  TUTORIAL_FOREST_MAP_ID, WATER_REACH_MAP_ID, type MapId,
} from "../../world";

type BossPortalCutscene = { mapId: MapId; portal: "portal" | "secondaryPortal"; seenKey: string };

/** The early bosses whose first defeat plays a cutscene of a portal on their map, and its once-only seen flag. */
export const BOSS_PORTAL_CUTSCENES = {
  dragon: { mapId: TUTORIAL_FOREST_MAP_ID, portal: "portal", seenKey: DRAGON_PORTAL_CUTSCENE_SEEN_KEY },
  spider: { mapId: BEGINNER_DESERT_MAP_ID, portal: "secondaryPortal", seenKey: SNOWLANDS_PORTAL_CUTSCENE_SEEN_KEY },
  frostclaw: { mapId: INTERMEDIATE_SNOWLANDS_MAP_ID, portal: "secondaryPortal", seenKey: LAVA_PORTAL_CUTSCENE_SEEN_KEY },
  magmalisk: { mapId: ADVANCED_LAVA_WASTES_MAP_ID, portal: "secondaryPortal", seenKey: INFERNAL_PORTAL_CUTSCENE_SEEN_KEY },
  gloomroot: { mapId: INFERNAL_DEPTHS_MAP_ID, portal: "secondaryPortal", seenKey: WATER_PORTAL_CUTSCENE_SEEN_KEY },
  tidewyrm: { mapId: WATER_REACH_MAP_ID, portal: "secondaryPortal", seenKey: SAMURAI_PORTAL_CUTSCENE_SEEN_KEY },
} as const satisfies Record<string, BossPortalCutscene>;

export type PortalCutsceneBoss = keyof typeof BOSS_PORTAL_CUTSCENES;

/** Each boss's cutscene as the boss controller takes it: whether it was seen, and how to start it. */
export function bossPortalCutscenes(hasSeen: (seenKey: string) => boolean, maps: Pick<MapController, "startBossPortalCutscene">) {
  const bosses = Object.keys(BOSS_PORTAL_CUTSCENES) as PortalCutsceneBoss[];
  return Object.fromEntries(bosses.map((boss) => [boss, {
    seen: () => hasSeen(BOSS_PORTAL_CUTSCENES[boss].seenKey),
    start: () => maps.startBossPortalCutscene(boss),
  }])) as Record<PortalCutsceneBoss, { seen: () => boolean; start: () => boolean }>;
}
