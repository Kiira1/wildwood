import { CAMPAIGN_MAPS, type CampaignMapDefinition } from "./campaign-registry";
import { MAP_IDS } from "./rules";

export const CAMPAIGN_UNLOCK_FIELDS = ["desertUnlocked", "snowlandsUnlocked", "lavaUnlocked", "infernalUnlocked",
  "waterUnlocked", "samuraiUnlocked", "cloudspireUnlocked", "moonfenUnlocked", "crystalHollowsUnlocked",
  "clockworkRuinsUnlocked", "duskfallOrchardUnlocked", "neonBastionUnlocked", "verdantCatacombsUnlocked", "ionCitadelUnlocked"] as const;
export type CampaignAccess = Partial<Record<typeof CAMPAIGN_UNLOCK_FIELDS[number], boolean>> & { bossRewardClaims?: number };

/** Existing saves retain their flags; added maps use the preceding boss's claim. */
export function campaignMapUnlocked(index: number, progress: CampaignAccess, maps: readonly CampaignMapDefinition[] = CAMPAIGN_MAPS) {
  if (index === 0) return true;
  const map = maps[index];
  if (!map || index < 0) return false;
  if ((CAMPAIGN_UNLOCK_FIELDS as readonly string[]).includes(map.unlockField)) return Boolean(progress[map.unlockField as typeof CAMPAIGN_UNLOCK_FIELDS[number]]);
  return Boolean((progress.bossRewardClaims ?? 0) & 2 ** maps[index - 1].claimIndex);
}
export function highestCampaignMap(progress: CampaignAccess) {
  return CAMPAIGN_MAPS.reduce((highest, _map, index) => campaignMapUnlocked(index, progress) ? index : highest, 0);
}

/**
 * Campaign map the player may actually stand on. MAP_IDS is the ladder in
 * order and CAMPAIGN_UNLOCK_FIELDS holds the flag for each rung above the
 * first, so a map they have not earned sends them to their highest rung.
 * Maps outside the ladder (home, procedural) are left for their own checks.
 */
export function accessibleCampaignMap(mapId: string, progress: CampaignAccess): string {
  const rung = MAP_IDS.indexOf(mapId);
  if (rung <= 0 || campaignMapUnlocked(rung, progress)) return mapId;
  return MAP_IDS[highestCampaignMap(progress)];
}

