import { describe, expect, it } from "vitest";
import { removeGreenPixels } from "./sprite-pixels";

describe("sprite pixel preprocessing", () => {
  it("keys out the green backdrop and keeps everything else", () => {
    const pixels = new Uint8ClampedArray([
      0, 255, 0, 255,
      240, 245, 250, 255,
      120, 170, 90, 255,
    ]);
    removeGreenPixels(pixels, 145, 1.45);
    expect([pixels[3], pixels[7], pixels[11]]).toEqual([0, 255, 255]);
  });
});
