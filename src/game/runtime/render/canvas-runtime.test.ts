import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasViewportMetrics, createCanvasRuntime, gameplayBottomInset } from "./canvas-runtime";

afterEach(() => vi.unstubAllGlobals());

it("reinitializes a restored context at the same size without reallocating its bitmap", () => {
  const windowValue = new EventTarget();
  const doc = Object.assign(new EventTarget(), { documentElement: {
    style: { getPropertyValue: () => "64px", setProperty: vi.fn() },
  }, visibilityState: "visible" });
  vi.stubGlobal("window", windowValue);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("devicePixelRatio", 3);
  let frame: (() => void) | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { frame = callback; return 1; });
  const ctx = { setTransform: vi.fn(), imageSmoothingEnabled: true };
  const canvas = Object.assign(new EventTarget(), { width: 780, height: 1560, style: {}, getContext: () => ctx });
  const widthWrite = vi.fn();
  Object.defineProperty(canvas, "width", { get: () => 780, set: widthWrite });
  createCanvasRuntime({ canvas: canvas as unknown as HTMLCanvasElement, bottomInset: () => 64, getActorShadowSprite: () => null });
  ctx.setTransform.mockClear();
  ctx.imageSmoothingEnabled = true;
  canvas.dispatchEvent(new Event("contextrestored"));
  expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  expect(ctx.imageSmoothingEnabled).toBe(false);
  expect(widthWrite).not.toHaveBeenCalled();
  vi.stubGlobal("innerHeight", 900);
  doc.dispatchEvent(new Event("visibilitychange"));
  frame?.();
  expect(canvas.height).toBe(1672);
});

describe("gameplay canvas bottom inset", () => {
  it("reserves only the toolbar so compact chat overlays the world", () => {
    expect(gameplayBottomInset(64)).toBe(64);
  });

  it("fills the screen behind replay controls and restores the gameplay toolbar space", () => {
    expect(canvasViewportMetrics(390, 844, gameplayBottomInset(64, true), 3).height).toBe(844);
    expect(canvasViewportMetrics(390, 844, gameplayBottomInset(64, false), 3).height).toBe(780);
  });
});

describe("gameplay canvas viewport", () => {
  it("computes a bounded high-DPI backing store", () => {
    expect(canvasViewportMetrics(390, 844, 64, 4)).toEqual({
      width: 390,
      height: 780,
      reservedBottom: 64,
      dpr: 2,
      backingWidth: 780,
      backingHeight: 1560,
    });
  });

  it("returns identical metrics for duplicate resize events", () => {
    const first = canvasViewportMetrics(430, 932, 70, 3);
    expect(canvasViewportMetrics(430, 932, 70, 3)).toEqual(first);
  });
});
