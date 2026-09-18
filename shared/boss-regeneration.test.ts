import { expect, it } from "vitest";
import { bossHitsToDefeat } from "./boss-regeneration";
it("accounts for regeneration between boss hits while allowing one-shots", () => {
  expect(bossHitsToDefeat(1000, 1000, 2)).toBe(1);
  expect(bossHitsToDefeat(1000, 100, 1)).toBe(11);
  expect(bossHitsToDefeat(1000, 1, 1)).toBe(Infinity);
  expect(bossHitsToDefeat(1000, .5, 1)).toBe(Infinity);
});
