import { describe, expect, it } from "vitest";
import { measureSource } from "../../tests/helpers/source-readability";

// Lower the long-line and byte numbers as extractions land; never raise them.
const MAX_LINES_OVER_160 = 14;
const MAX_LINES_OVER_300 = 0;
const MAX_BYTES = 44_852;

const coopSource = new URL("../wildstat-coop.ts", import.meta.url);

describe("wildstat coop composition boundary", () => {
  // Intentional agent-context budget: extract focused modules when this grows.
  // Do not satisfy it by packing code onto longer lines or removing useful comments.
  it("keeps the browser-facing facade below 1,000 lines", () => {
    expect(measureSource(coopSource).lines).toBeLessThan(1_000);
  });

  it("adds no long lines, so the line limit cannot be dodged by packing", () => {
    const measure = measureSource(coopSource);
    expect(measure.linesOver160).toBeLessThanOrEqual(MAX_LINES_OVER_160);
    expect(measure.linesOver300).toBeLessThanOrEqual(MAX_LINES_OVER_300);
  });

  it("never grows past its byte budget", () => {
    expect(measureSource(coopSource).bytes).toBeLessThanOrEqual(MAX_BYTES);
  });
});
