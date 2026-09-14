import { describe, expect, it } from "vitest";
import { adjustmentKey, alignment, freshDraft, parseDraft } from "./state";
import { localDragDelta } from "./preview";

describe("character studio drafts", () => {
  it("keeps eye fits per helmet and includes spacing in saved drafts", () => {
    const draft = freshDraft();
    draft.adjustments[adjustmentKey(draft, "eyes")] = { x: 2, y: 3, scale: .8, spacing: 1.2 };
    draft.outfit.headItem = "wood_full_helm";
    expect(alignment(draft).eyes).toBeUndefined();
    draft.outfit.headItem = "basic_paper_hat";
    const saved = parseDraft(JSON.parse(JSON.stringify(draft)));
    expect(alignment(saved).eyes).toEqual({ x: 2, y: 3, scale: .8, spacing: 1.2 });
    for (const spacing of [0, NaN, 3]) {
      expect(() => parseDraft({ ...draft, adjustments: { "eyes:basic_paper_hat": { x: 0, y: 0, scale: 1, spacing } } })).toThrow();
    }
  });
  it("preserves independent changes for current game and source-default baselines", () => {
    const draft = freshDraft();
    draft.adjustments[adjustmentKey(draft, "weapon")] = { x: 8, y: 2, scale: 1 };
    draft.basis = "source";
    expect(alignment(draft).weapon).toBeUndefined();
    draft.adjustments[adjustmentKey(draft, "weapon")] = { x: -3, y: 0, scale: .8 };
    const restored = parseDraft(JSON.parse(JSON.stringify(draft)));
    expect(alignment(restored).weapon?.x).toBe(-3);
    restored.basis = "game";
    expect(alignment(restored).weapon?.x).toBe(8);
  });
  it("keeps each helmet's adjustments when switching outfits and importing again", () => {
    const draft = freshDraft();
    const key = adjustmentKey(draft, "helmet");
    draft.adjustments[key] = { x: 3, y: -4, scale: 1.2 };
    draft.outfit.headItem = "";
    expect(alignment(draft).helmet).toBeUndefined();
    draft.outfit.headItem = "basic_paper_hat";
    const restored = parseDraft(JSON.parse(JSON.stringify(draft)));
    expect(alignment(restored).helmet).toEqual({ x: 3, y: -4, scale: 1.2 });
  });

  it("remembers bare legs separately from equipped boots", () => {
    const draft = freshDraft();
    draft.adjustments[adjustmentKey(draft, "frontLeg")] = { x: 2, y: 0, scale: 1 };
    draft.outfit.feetItem = "trailblazer_boots";
    expect(alignment(draft).frontLeg).toBeUndefined();
    expect(alignment(draft).backLeg).toBeUndefined();
  });

  it("rejects wrong slot artwork and unsafe numeric input without altering the current draft", () => {
    const original = freshDraft();
    expect(() => parseDraft({ ...original, outfit: { ...original.outfit, headItem: "starter_stone" } })).toThrow("Unknown item");
    for (const value of [NaN, Infinity, 1001]) {
      expect(() => parseDraft({ ...original, adjustments: { "head:base": { x: value, y: 0, scale: 1 } } })).toThrow();
    }
    expect(() => parseDraft({ ...original, adjustments: { "head:base": { x: 0, y: 0, scale: 0 } } })).toThrow();
    expect(() => parseDraft({ ...original, version: 2 })).toThrow();
    expect(original).toEqual(freshDraft());
  });
});

describe("screen-space dragging", () => {
  it("moves with the cursor when the character is mirrored and zoomed", () => {
    const delta = localDragDelta({ x: 0, y: 0, width: 1, height: 1, axes: { a: -3.6, b: 0, c: 0, d: 3.6 } }, 18, 36);
    expect(delta.x).toBeCloseTo(-5);
    expect(delta.y).toBeCloseTo(10);
  });
  it("inverts weapon rotation so aiming up does not send a horizontal drag vertically", () => {
    expect(localDragDelta({ x: 0, y: 0, width: 1, height: 1, axes: { a: 0, b: 2, c: -2, d: 0 } }, 10, 6))
      .toEqual({ x: 3, y: -5 });
  });
});
