import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlowCache } from "./glow-cache";
import { drawBrightened } from "./brighten";
import { beginTownTeleport, drawTownTeleport, endTownTeleport } from "../town/town-teleport";
import { drawGravebloomArt } from "../boss/verdant-boss-art";

/** A 2D context that records every property set and call, with a fixed device scale. */
function recordingContext(scale = 2) {
  const sets: string[] = []; const calls: string[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === "getTransform") return () => ({ a: scale, b: 0 });
      if (key in target) return target[key];
      return () => { calls.push(key); return key === "createRadialGradient" ? { addColorStop() {} } : undefined; };
    },
    set(target, key: string, value) { sets.push(key); target[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, sets, calls };
}
const FRAME_FALLBACKS = ["shadowBlur", "shadowColor", "shadowOffsetX", "shadowOffsetY", "filter"];

describe("baked glows", () => {
  it("bakes a sprite's halo once and draws frames without shadows or filters", () => {
    const bakes: ReturnType<typeof recordingContext>[] = [];
    const glow = createGlowCache(() => { const bake = recordingContext(1); bakes.push(bake); return { width: 0, height: 0, getContext: () => bake.ctx }; });
    const frame = recordingContext();
    const sprite = {} as CanvasImageSource; const owner = {};
    for (let i = 0; i < 30; i++) expect(glow(frame.ctx, owner, sprite, 10 + i, 20, 88, 68, "rgba(116,225,255,.8)", 8)).toBe(true);
    expect(bakes).toHaveLength(1);
    expect(bakes[0].sets).toContain("shadowBlur");
    expect(frame.sets.filter(key => FRAME_FALLBACKS.includes(key))).toEqual([]);
    expect(frame.calls.filter(call => call === "drawImage")).toHaveLength(30);
  });
  it("re-bakes only when the size or zoom step changes", () => {
    let made = 0;
    const glow = createGlowCache(() => { made += 1; const bake = recordingContext(1); return { width: 0, height: 0, getContext: () => bake.ctx }; });
    const owner = {};
    glow(recordingContext(2).ctx, owner, {} as CanvasImageSource, 0, 0, 40, 40, "#fff", 8);
    glow(recordingContext(2.05).ctx, owner, {} as CanvasImageSource, 0, 0, 40, 40, "#fff", 8);
    expect(made).toBe(1);
    glow(recordingContext(2.5).ctx, owner, {} as CanvasImageSource, 0, 0, 40, 40, "#fff", 8);
    glow(recordingContext(2.5).ctx, owner, {} as CanvasImageSource, 0, 0, 50, 40, "#fff", 8);
    expect(made).toBe(3);
  });
  it("draws nothing where the scale cannot be read", () => {
    const glow = createGlowCache(() => { throw new Error("no bake"); });
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    expect(glow(ctx, {}, {} as CanvasImageSource, 0, 0, 10, 10, "#fff", 8)).toBe(false);
  });
});

describe("frame draws without Firefox fallbacks", () => {
  afterEach(() => { endTownTeleport(); vi.restoreAllMocks(); });
  it("the Town teleport sets no shadow or filter", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    beginTownTeleport();
    const frame = recordingContext();
    const player = vi.fn();
    for (now = 0; now < 640; now += 16) drawTownTeleport(frame.ctx, 100, 100, player);
    expect(player).toHaveBeenCalled();
    expect(frame.sets.filter(key => FRAME_FALLBACKS.includes(key))).toEqual([]);
  });
  it("brightness is a second additive draw, not a filter", () => {
    const frame = recordingContext();
    const draw = vi.fn();
    drawBrightened(frame.ctx, .7, draw);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(frame.sets).toContain("globalCompositeOperation");
    expect(frame.sets).not.toContain("filter");
    drawBrightened(frame.ctx, 0, draw);
    expect(draw).toHaveBeenCalledTimes(3);
  });
  it("Gravebloom's hurt flash sets no filter", () => {
    const frame = recordingContext();
    drawGravebloomArt(frame.ctx, 0, 0, 1, "idle", .1, { naturalWidth: 420, naturalHeight: 420 } as HTMLImageElement);
    expect(frame.sets).not.toContain("filter");
    expect(frame.calls.filter(call => call === "drawImage")).toHaveLength(2);
  });
});
