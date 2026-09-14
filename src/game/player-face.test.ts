import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { tintedHeadPixels, eyeGeometry, PLAYER_HEAD_SIZE } from "./player-face";
import { EXPANSION_HEAD_FRAME } from "./player-head-template";

describe("expansion helmet template", () => {
  it("preserves the edited PNG pixels and restored source transparency", () => {
    expect(PLAYER_HEAD_SIZE).toEqual({ width: 65, height: 50 });
    expect(createHash("sha256").update(tintedHeadPixels("#ffffff")).digest("hex"))
      .toBe("4160457bf3858c0cc8c40ebac1e040fe4447d910445f87e0e7a6ba7d972d0393");
  });
  it("uses the PSD head position relative to the shared helmet export frame", () => {
    expect(EXPANSION_HEAD_FRAME.x - 31).toBe(54 - 32);
    expect(EXPANSION_HEAD_FRAME.y - 38).toBe(67 - 33);
  });
  it("recolors white skin while preserving the outline and source alpha", () => {
    const original = tintedHeadPixels("#ffffff"), tinted = tintedHeadPixels("#d99e76");
    for (let i = 0; i < original.length; i += 4) {
      expect(tinted[i + 3]).toBe(original[i + 3]);
      if (original[i] === 0) expect([...tinted.slice(i, i + 3)]).toEqual([0, 0, 0]);
      if (original[i] === 255) expect([...tinted.slice(i, i + 3)]).toEqual([217, 158, 118]);
    }
  });
  it("edits eye spacing independently around a stable midpoint", () => {
    const original = eyeGeometry(65, 50), wider = eyeGeometry(65, 50, 1.5);
    expect((wider.left + wider.right) / 2).toBeCloseTo((original.left + original.right) / 2);
    expect(wider.right - wider.left).toBeCloseTo((original.right - original.left) * 1.5);
    expect(wider.radius).toBe(original.radius);
    expect(wider.y).toBe(original.y);
  });
});
