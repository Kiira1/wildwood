import { describe, expect, it } from "vitest";
import { gripAtPoint, previewAim } from "./weapon-transform";
import { freshDraft, parseDraft } from "./state";

describe("weapon alignment controls", () => {
  it("keeps forward aim attached to facing while up/down remain vertical", () => {
    expect(previewAim("0", "right")).toBe(0);
    expect(previewAim("0", "left")).toBe(Math.PI);
    expect(previewAim("180", "left")).toBe(0);
    for (const facing of ["left", "right"]) {
      expect(Math.sin(previewAim("90", facing)!)).toBeCloseTo(1);
      expect(Math.sin(previewAim("270", facing)!)).toBeCloseTo(-1);
      expect(previewAim("none", facing)).toBeNull();
    }
  });
  it("picks the source grip through a mirrored, rotated canvas transform", () => {
    expect(gripAtPoint({ x: 0, y: 0, width: 40, height: 200,
      source: { x: 0, y: 0, width: 100, height: 20 }, transform: { a: 0, b: -2, c: -2, d: 0, e: 100, f: 100 } }, 80, 60))
      .toEqual({ x: .2, y: .5 });
  });
  it("round trips new transforms while continuing to accept older drafts", () => {
    const draft = freshDraft();
    draft.adjustments["weapon:starter_stone"] = { x: 1, y: 2, scale: 1, angle: -45, flipX: true, pivotX: .2, pivotY: .6 };
    expect(parseDraft(JSON.parse(JSON.stringify(draft))).adjustments).toEqual(draft.adjustments);
    draft.adjustments["weapon:starter_stone"] = { x: 1, y: 2, scale: 1 };
    expect(parseDraft(draft).adjustments).toEqual(draft.adjustments);
    for (const invalid of [{ angle: NaN }, { angle: 181 }, { pivotX: -1 }, { pivotY: Infinity }, { flipX: "true" }]) {
      expect(() => parseDraft({ ...draft, adjustments: { "weapon:starter_stone": { x: 0, y: 0, scale: 1, ...invalid } } })).toThrow();
    }
  });
});
