import { describe, expect, it, vi } from "vitest";
import { createRenderController, snapToDevicePixel } from "./render-controller";

function arena(ready: boolean, replay: boolean) {
  const scene = { countdown: 3, hitMultiplier: 1 };
  const ctx = new Proxy({} as any, { get: (target, key) => target[key] ??= vi.fn() });
  const options = new Proxy({
    ctx, camera: { x: 0, y: 0, zoom: 1 }, player: { x: 5000, y: 5000, attackRange: 200 },
    viewport: () => ({ width: 900, height: 700, dpr: 1 }), remotePlayers: vi.fn(() => []),
    duelAssetsReady: () => ready, isReplayActive: () => replay,
    replayScene: () => replay ? scene : null, heldScene: () => null,
    duelResultHeld: () => false, liveScene: () => scene, isDueling: () => !replay,
  } as any, { get: (target, key) => target[key] ??= vi.fn() });
  return { ctx, options, render: createRenderController(options).render, scene };
}
it("holds live arena rendering until its art has settled", () => {
  const f = arena(false, false); f.render();
  expect(f.options.drawDuelArena).not.toHaveBeenCalled();
  expect(f.options.drawDuelScene).not.toHaveBeenCalled();
  expect(f.ctx.fillText).toHaveBeenCalledWith("LOADING ARENA…", 450, 350);
  expect(f.options.setRenderedDuelScene).toHaveBeenCalledWith(null);
});
it("resets the canvas state after a drawing error and renders the next frame", () => {
  const f = arena(true, true), reset = vi.fn();
  f.ctx.canvas = { get width() { return 1800; }, set width(_value) { reset(); } };
  f.options.viewport = () => ({ width: 900, height: 700, dpr: 2 });
  f.render = createRenderController(f.options).render;
  f.options.drawDuelScene.mockImplementationOnce(() => { throw new Error("draw failed"); });
  expect(() => f.render()).toThrow("draw failed");
  expect(reset).toHaveBeenCalledOnce();
  expect(f.ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  expect(() => f.render()).not.toThrow();
  expect(f.options.drawDuelScene).toHaveBeenCalledTimes(2);
});
it.each([true, false])("keeps arena lighting independent of exploration coordinates (replay=%s)", replay => {
  const f = arena(true, replay); f.render();
  expect(f.options.drawDuelScene).toHaveBeenCalledWith(f.scene);
  expect(f.ctx.createRadialGradient).not.toHaveBeenCalled();
});
it("does not redraw a covered world while keeping menu previews alive", () => {
  const f = arena(true, false);
  f.options.worldOccluded = () => true;
  f.render();
  expect(f.options.drawProfileCharacterPreview).toHaveBeenCalledOnce();
  expect(f.options.remotePlayers).not.toHaveBeenCalled();
  expect(f.options.drawDuelScene).not.toHaveBeenCalled();
  expect(f.options.drawStaticWorld).not.toHaveBeenCalled();
  f.options.worldOccluded = () => false;
  f.render();
  expect(f.options.drawDuelScene).toHaveBeenCalledOnce();
});

describe("snapToDevicePixel", () => {
  it("keeps shake transforms on physical pixel boundaries", () => {
    expect(snapToDevicePixel(1.26, 2)).toBe(1.5);
    expect(snapToDevicePixel(-1.26, 2)).toBe(-1.5);
    expect(snapToDevicePixel(.2, 3)).toBeCloseTo(1 / 3);
  });

  it("falls back safely for invalid pixel ratios", () => {
    expect(snapToDevicePixel(1.6, Number.NaN)).toBe(2);
    expect(snapToDevicePixel(1.6, 0)).toBe(2);
  });
});
