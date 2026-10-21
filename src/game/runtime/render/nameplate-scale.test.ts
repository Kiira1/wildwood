import { describe, expect, it } from "vitest";
import { NAMEPLATE_SCALE, PLATE_MIN_STROKE, plateStroke } from "./nameplate-scale";

describe("overhead plate scale", () => {
  it("draws plate outlines a pixel thinner, but never thinner than a 1.2px outline", () => {
    // Canvas strokes half outside the glyph: a pixel off the outline is two off the width.
    expect(plateStroke(4)).toBe(PLATE_MIN_STROKE);
    expect(plateStroke(3)).toBe(PLATE_MIN_STROKE);
    expect(plateStroke(6)).toBeCloseTo(6 * NAMEPLATE_SCALE - 2);
    // A hairline (the health numbers): kept, not thickened.
    expect(plateStroke(2)).toBeCloseTo(2 * NAMEPLATE_SCALE);
  });
});
