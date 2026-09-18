import { expect, it } from "vitest";
import { campaignMapTargetSeconds, CAMPAIGN_ENTRY_TARGET_SECONDS } from "./campaign-pacing";
it("uses the restored campaign duration reference without retuning gameplay", () => {
  expect(campaignMapTargetSeconds(0)).toBe(48 * 60);
  expect(campaignMapTargetSeconds(1)).toBe(52 * 60);
  expect(campaignMapTargetSeconds(14)).toBe((52 + 13 * 76) * 60);
  expect(CAMPAIGN_ENTRY_TARGET_SECONDS).toBe(Array.from({length: 15}, (_, i) => campaignMapTargetSeconds(i)).reduce((a,b) => a+b, 0));
});
