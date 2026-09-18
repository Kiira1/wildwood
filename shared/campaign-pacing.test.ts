import { expect, it } from "vitest";
import { campaignMapTargetSeconds, CAMPAIGN_ENTRY_TARGET_SECONDS, CAMPAIGN_PACING_MAPS } from "./campaign-pacing";
it("allocates a rounded seven-day campaign with a substantial opening", () => {
  const targets = Array.from({ length: CAMPAIGN_PACING_MAPS }, (_, i) => campaignMapTargetSeconds(i));
  expect(targets[0]).toBe(3600);
  expect(targets[1]).toBe(5400);
  expect(targets.reduce((a, b) => a + b, 0)).toBeCloseTo(CAMPAIGN_ENTRY_TARGET_SECONDS);
  for (let i = 1; i < targets.length; i++) expect(targets[i]).toBeGreaterThanOrEqual(targets[i - 1]);
  expect(targets[2]).toBe(6 * 3600);
  expect(targets[3]).toBe(12.5 * 3600);
  for (let i = 5; i < targets.length; i++) expect(targets[i] / targets[i - 1]).toBeLessThan(1.04);
});
