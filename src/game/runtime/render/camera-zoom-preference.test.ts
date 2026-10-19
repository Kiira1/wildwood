import { afterEach, expect, it } from "vitest";
import { CAMERA_ZOOM_LEVELS, canZoomCamera, cameraZoomPreference, resetCameraZoomPreference, stepCameraZoom } from "./camera-zoom-preference";
import { drawScreenSpaceAt } from "./render-space";

afterEach(resetCameraZoomPreference);

it("offers 21 levels from 50% to 150% in 5% steps, starting at 100%", () => {
  expect(CAMERA_ZOOM_LEVELS).toHaveLength(21);
  expect(CAMERA_ZOOM_LEVELS[0]).toBe(.5);
  expect(CAMERA_ZOOM_LEVELS.at(-1)).toBe(1.5);
  expect(cameraZoomPreference()).toBe(1);
});

it("steps one level at a time and stops at either end", () => {
  expect(stepCameraZoom(1)).toBe(1.05);
  for (let i = 0; i < 30; i++) stepCameraZoom(1);
  expect(cameraZoomPreference()).toBe(1.5);
  expect(canZoomCamera(1)).toBe(false);
  for (let i = 0; i < 30; i++) stepCameraZoom(-1);
  expect(cameraZoomPreference()).toBe(.5);
  expect(canZoomCamera(-1)).toBe(false);
});

it("scales floating labels with the player's zoom", () => {
  const scales: number[] = [];
  const ctx = { save() {}, restore() {}, translate() {}, scale: (x: number) => { scales.push(x); } } as unknown as CanvasRenderingContext2D;
  drawScreenSpaceAt(ctx, 2, 0, 0, () => {});
  stepCameraZoom(1); stepCameraZoom(1);
  drawScreenSpaceAt(ctx, 2, 0, 0, () => {});
  expect(scales[0]).toBeCloseTo(.5);
  expect(scales[1]).toBeCloseTo(1.1 / 2);
});

it("starts at 100% when nothing is saved, not at the 50% end", async () => {
  const store = new Map<string, string>();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } as Storage;
  try {
    const { vi } = await import("vitest");
    vi.resetModules();
    const fresh = await import("./camera-zoom-preference");
    expect(fresh.cameraZoomPreference()).toBe(1);
  } finally { globalThis.localStorage = previous; }
});

it("keeps a zoom saved before the wider range, and remembers the new one as a percentage", async () => {
  const store = new Map<string, string>();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } as Storage;
  try {
    const { vi } = await import("vitest");
    // Step 12 of the old 70%-130% range was 130%.
    store.set("wildstat.cameraZoomStep", "12");
    vi.resetModules();
    const old = await import("./camera-zoom-preference");
    expect(old.cameraZoomPreference()).toBe(1.3);
    old.stepCameraZoom(1);
    expect(store.get("wildstat.cameraZoomPercent")).toBe("135");
    vi.resetModules();
    expect((await import("./camera-zoom-preference")).cameraZoomPreference()).toBe(1.35);
  } finally { globalThis.localStorage = previous; }
});
