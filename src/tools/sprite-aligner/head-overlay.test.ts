import { expect, it } from "vitest";
import { headOverlayRegistration } from "./head-overlay";
it("registers the actual expansion head at native size without eye-based rescaling", () => {
  expect(headOverlayRegistration("expansion")).toEqual({ scale: 1, x: 0, y: 0 });
  expect(headOverlayRegistration("5")).toBeNull();
  expect(headOverlayRegistration("../../elsewhere")).toBeNull();
});
