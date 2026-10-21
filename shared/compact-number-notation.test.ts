import { afterEach, expect, it } from "vitest";
import { compactNumberChanged, formatCompactNumber, setNumberNotation } from "./compact-number";

afterEach(() => setNumberNotation("suffix"));

// The server only broadcasts power changes a player could see on the suffix form.
it("keeps the server's change check on suffixes whatever the notation setting", () => {
  setNumberNotation("scientific");
  expect(formatCompactNumber(1.73e14)).toBe("1.73e14");
  expect(compactNumberChanged(1_000_000, 1_001_000)).toBe(false);
  expect(compactNumberChanged(1_000_000, 1_010_000)).toBe(true);
});
