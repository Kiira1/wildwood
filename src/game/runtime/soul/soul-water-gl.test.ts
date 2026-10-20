import { afterEach, describe, expect, it, vi } from "vitest";
import { TOWN_CENTER, TOWN_WEST_BRIDGE } from "../../../../shared/town";
import { createSoulWaterGL, routeRiver } from "./soul-water-gl";
import { SOUL_WATER_CELLS } from "./soul-water-cells";
import type { StaticWorldLayer, StaticWorldLayerFrame } from "../render/webgl-static-world-layer";

afterEach(() => vi.unstubAllGlobals());

/** A WebGL context that records its calls by name; constants are their own names. */
function fakeGL(maxTextureSize = 4_096) {
  const calls: string[] = [];
  const gl = new Proxy({} as Record<string, unknown>, {
    get: (target, key) => {
      if (typeof key !== "string") return undefined;
      if (/^[A-Z_0-9]+$/.test(key)) return key === "NO_ERROR" ? 0 : key;
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        calls.push(key === "activeTexture" || key === "enable" || key === "disable" ? `${key}:${String(args[0])}` : key);
        if (key === "getShaderParameter" || key === "getProgramParameter") return true;
        if (key === "getError") return 0;
        if (key === "getParameter") return maxTextureSize;
        if (key === "getVertexAttrib") return true;
        return {};
      };
    },
  });
  return { gl: gl as unknown as WebGLRenderingContext, calls };
}

const sheet = (complete = true) => ({ complete, naturalWidth: complete ? SOUL_WATER_CELLS.width : 0, naturalHeight: SOUL_WATER_CELLS.height }) as unknown as HTMLImageElement;
const frame: StaticWorldLayerFrame = { backgroundColor: "#000", width: 1_280, height: 800, dpr: 1, zoom: 1, tiles: [] };

function river(at: { x: number; y: number }, options: { active?: () => boolean; loaded?: boolean } = {}) {
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) });
  const camera = { x: at.x - 640, y: at.y - 400, zoom: 1 };
  let t = 10;
  const draw = createSoulWaterGL({ camera, water: () => sheet(options.loaded ?? true), shore: () => sheet(options.loaded ?? true), time: () => t, active: options.active ?? (() => true) });
  return { camera, draw, tick: () => { t += 1 / 60; } };
}

describe("the village river in WebGL", () => {
  it("uploads its textures once, then draws one quad a frame and leaves the layer's state as it was", () => {
    const { gl, calls } = fakeGL();
    const r = river(TOWN_WEST_BRIDGE);
    for (let i = 0; i < 30; i++) { expect(r.draw(gl, frame)).toBe(true); r.tick(); }
    expect(calls.filter(call => call === "texImage2D")).toHaveLength(4);
    expect(calls.filter(call => call === "drawArrays")).toHaveLength(30);
    const afterDraw = calls.slice(calls.lastIndexOf("drawArrays"));
    expect(afterDraw).toContain("disable:BLEND");
    expect(afterDraw).toContain("activeTexture:TEXTURE0");
  });

  it("handles a view with no water by drawing nothing", () => {
    const { gl, calls } = fakeGL();
    expect(river(TOWN_CENTER).draw(gl, frame)).toBe(true);
    expect(calls).not.toContain("drawArrays");
  });

  it("leaves the river to the canvas while off, before its sheets load, or on a GPU too small for them", () => {
    const off = fakeGL();
    expect(river(TOWN_WEST_BRIDGE, { active: () => false }).draw(off.gl, frame)).toBe(false);
    expect(river(TOWN_WEST_BRIDGE, { loaded: false }).draw(off.gl, frame)).toBe(false);
    expect(off.calls).toEqual([]);
    const small = fakeGL(2_048);
    const r = river(TOWN_WEST_BRIDGE);
    expect(r.draw(small.gl, frame)).toBe(false);
    expect(r.draw(small.gl, frame)).toBe(false);
    expect(small.calls.filter(call => call === "getParameter")).toHaveLength(1);
  });

  it("sets itself up again on a rebuilt layer's new context", () => {
    const first = fakeGL(), second = fakeGL();
    const r = river(TOWN_WEST_BRIDGE);
    r.draw(first.gl, frame);
    r.draw(second.gl, frame);
    expect(second.calls.filter(call => call === "texImage2D")).toHaveLength(4);
    expect(second.calls).toContain("drawArrays");
  });
});

describe("which layer draws the river", () => {
  function route(active = true) {
    let overlay: ((gl: WebGLRenderingContext, frame: StaticWorldLayerFrame) => boolean) | null = null;
    const layer = { active: () => active, setGroundOverlay: (draw: typeof overlay) => { overlay = draw; } } as unknown as StaticWorldLayer;
    let gpuDraws = true;
    const onCanvas = vi.fn();
    const drawWater = routeRiver(layer, () => gpuDraws, onCanvas);
    const gpuFrame = () => overlay!({} as WebGLRenderingContext, frame);
    return { drawWater, gpuFrame, onCanvas, setGpuDraws: (value: boolean) => { gpuDraws = value; } };
  }

  it("skips the canvas on frames the WebGL layer drew the river", () => {
    const r = route();
    r.gpuFrame(); r.drawWater();
    r.gpuFrame(); r.drawWater();
    expect(r.onCanvas).not.toHaveBeenCalled();
  });

  it("draws on the canvas when WebGL could not, or did not draw this frame", () => {
    const r = route();
    r.setGpuDraws(false);
    r.gpuFrame(); r.drawWater();
    expect(r.onCanvas).toHaveBeenCalledTimes(1);
    r.setGpuDraws(true);
    r.gpuFrame(); r.drawWater();
    r.drawWater();
    expect(r.onCanvas).toHaveBeenCalledTimes(2);
  });

  it("draws on the canvas once the layer has turned itself off", () => {
    const r = route(false);
    r.gpuFrame(); r.drawWater();
    expect(r.onCanvas).toHaveBeenCalledOnce();
  });
});
