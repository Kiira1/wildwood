import { describe, expect, it } from "vitest";
import { WORLD_HEALTH_BAR_HEIGHT } from "../game-settings";
import { ENEMY_HEALTH_BAR_HEIGHT } from "../enemies/enemy-status-plate";
import { NAMEPLATE_SCALE, PLATE_MIN_STROKE, plateFont, platePixels, plateStroke } from "./nameplate-scale";
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

  it("draws plate outlines a pixel thinner, but never thinner than a 1px outline", () => {
    // Canvas strokes half outside the glyph: a pixel off the outline is two off the width.
    expect(plateStroke(4)).toBe(PLATE_MIN_STROKE);
    expect(plateStroke(3)).toBe(PLATE_MIN_STROKE);
    expect(plateStroke(6)).toBeCloseTo(6 * NAMEPLATE_SCALE - 2);
    // Already under a 1px outline: kept, not thickened.
    expect(plateStroke(2)).toBeCloseTo(2 * NAMEPLATE_SCALE);
  });
});
