import { CAMPAIGN_PROGRESSION_BOSS_HEALTH } from "../../shared/campaign-progression";
import { defaultBalanceSettings } from "../../shared/map-balance";
import type { BalanceSettings } from "../../shared/map-balance-types";

/** The defaults before the curve (0.915): the campaign health, progression and reward-floor curves, as old revisions still resolve. */
export function legacyBalanceSettings(): BalanceSettings {
  const settings = defaultBalanceSettings();
  delete settings.curveVersion;
  Object.assign(settings, { campaignHealthVersion: 1, campaignRewardVersion: 1, campaignProgressionVersion: 1 });
  for (const [id, factors] of Object.entries(settings.maps)) factors.bossHealth = CAMPAIGN_PROGRESSION_BOSS_HEALTH[id] ?? 1;
  return settings;
}
