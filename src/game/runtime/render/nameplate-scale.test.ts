import { describe, expect, it } from "vitest";
import { WORLD_HEALTH_BAR_HEIGHT } from "../game-settings";
import { ENEMY_HEALTH_BAR_HEIGHT } from "../enemies/enemy-status-plate";
import { NAMEPLATE_SCALE, plateFont, platePixels } from "./nameplate-scale";
import { OVERHEAD_PLATE_GAP } from "./overhead-plate";

describe("overhead plate scale", () => {
  it("shrinks the whole plate by about a fifth", () => {
    expect(NAMEPLATE_SCALE).toBeGreaterThanOrEqual(.75);
    expect(NAMEPLATE_SCALE).toBeLessThanOrEqual(.8);
  });

  it("keeps bars on whole pixels and text at the scaled size", () => {
    expect(platePixels(80)).toBe(62);
    expect(platePixels(WORLD_HEALTH_BAR_HEIGHT)).toBe(9);
    expect(ENEMY_HEALTH_BAR_HEIGHT).toBe(4);
    expect(plateFont(10)).toMatch(/^900 7\.8px /);
    expect(OVERHEAD_PLATE_GAP).toBeCloseTo(3 * NAMEPLATE_SCALE);
  });
});
