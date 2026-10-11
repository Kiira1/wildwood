import { expect, it } from "vitest";
import { formatRating } from "./rating-text";
import { RATING_MAX } from "../../shared/stat-rating";

it("reads a rating like armor: short, compact when large, Max at the cap (the Soul window showed +1e+302%)", () => {
  expect(formatRating(36.456)).toBe("36.5");
  expect(formatRating(52_460_844_040_682_650)).not.toMatch(/e\+|\d{7}/);
  expect(formatRating(RATING_MAX)).toBe("Max");
});
