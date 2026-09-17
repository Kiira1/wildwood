import { itemTier } from "./item-tier";
import { MAP_IDS, MAP_DISPLAY_NAMES } from "./rules";

export const CAMPAIGN_UNLOCK_FIELDS = ["desertUnlocked", "snowlandsUnlocked", "lavaUnlocked", "infernalUnlocked",
  "waterUnlocked", "samuraiUnlocked", "cloudspireUnlocked", "moonfenUnlocked", "crystalHollowsUnlocked",
  "clockworkRuinsUnlocked", "duskfallOrchardUnlocked", "neonBastionUnlocked", "verdantCatacombsUnlocked", "ionCitadelUnlocked"] as const;
export type CampaignAccess = Partial<Record<typeof CAMPAIGN_UNLOCK_FIELDS[number], boolean>>;

export function highestCampaignMap(progress: CampaignAccess) {
  return CAMPAIGN_UNLOCK_FIELDS.reduce((highest, field, index) => progress[field] ? index + 1 : highest, 0);
}

export function equipmentMapRequirement(itemId: string, progress: CampaignAccess | null | undefined): string | null {
  const tier = itemTier(itemId);
  if (!tier || tier <= 1 || progress?.[CAMPAIGN_UNLOCK_FIELDS[tier - 2]]) return null;
  return MAP_DISPLAY_NAMES[MAP_IDS[tier - 1] as keyof typeof MAP_DISPLAY_NAMES] ?? `Map ${tier}`;
}
