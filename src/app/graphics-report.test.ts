import { describe, expect, it, vi } from "vitest";
import { createGraphicsReport, GRAPHICS_REPORT_AFTER_MS } from "./graphics-report";
import { normalizeConnectionDiagnostic } from "../../shared/connection-diagnostics";

function memory() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; }
function fixture(storage = memory()) {
  const state = { hidden: false, playing: true, fullRate: true, fps: 48 };
  const report = vi.fn();
  const probe = vi.fn(() => ({ rendererClass: "Software" as const, renderer: "llvmpipe (LLVM 15.0.7, 256 bits)", vendor: "Mesa", masked: false, caveat: "pass" as const, webgl: true, webgl2: true }));
  const graphics = createGraphicsReport({ canvas: () => ({ width: 1280, height: 800 }), snapshot: () => ({ fps: state.fps, workFps: 120 }),
    playing: () => state.playing, fullRate: () => state.fullRate, hidden: () => state.hidden, probe, report, storage,
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0", dpr: () => 1.25 });
  const seconds = (count: number) => { for (let i = 0; i < count; i++) graphics.tick(1_000); };
  return { state, report, probe, graphics, seconds, storage };
}

describe("graphics diagnostic", () => {
  it("sends one report after a minute of visible play, never during hidden time", () => {
    const f = fixture();
    f.seconds(59);
    f.state.hidden = true; f.seconds(30);
    expect(f.report).not.toHaveBeenCalled();
    expect(f.probe).not.toHaveBeenCalled();
    f.state.hidden = false; f.seconds(1);
    expect(f.report).toHaveBeenCalledOnce();
    f.seconds(600);
    expect(f.report).toHaveBeenCalledOnce();
    const [kind, data] = f.report.mock.calls[0];
    expect(kind).toBe("graphics");
    expect(data.graphics).toMatchObject({ rendererClass: "Software", renderer: "llvmpipe (LLVM 15.0.7, 256 bits)", dpr: 1.25, canvasWidth: 1280, canvasHeight: 800,
      fpsAvg: 48, fpsLow: 48, workFps: 120, browser: "Firefox 158", os: "Linux" });
    expect(data.detail).toBe("Software; llvmpipe (256 bits); 48/48 fps");
  });
  it("does not report again after a reload in the same tab", () => {
    const storage = memory();
    const first = fixture(storage); first.seconds(GRAPHICS_REPORT_AFTER_MS / 1000);
    const second = fixture(storage); second.seconds(120);
    expect(first.report).toHaveBeenCalledOnce();
    expect(second.report).not.toHaveBeenCalled();
  });
  it("only counts FPS read after a few seconds at the full frame rate", () => {
    const f = fixture();
    f.state.fullRate = false; f.state.fps = 30; f.seconds(10);
    expect(f.graphics.text().fps).toBe("FPS: Measuring…");
    f.state.fullRate = true; f.state.fps = 60; f.seconds(2);
    expect(f.graphics.text().fps).toBe("FPS: Measuring…");
    f.seconds(1);
    expect(f.graphics.text().fps).toBe("FPS: avg 60 · low 60");
  });
  it("the server keeps the graphics fields and drops a graphics event without them", () => {
    const f = fixture(); f.seconds(60);
    const sample = normalizeConnectionDiagnostic({ ...f.report.mock.calls[0][1], kind: "graphics", eventId: "abcdefgh1234" });
    expect(sample).toMatchObject({ kind: "graphics", category: "graphics", graphics: { rendererClass: "Software", browser: "Firefox 158", dpr: 1.25 } });
    expect(normalizeConnectionDiagnostic({ kind: "graphics", eventId: "abcdefgh1234" })).toBeNull();
    expect(normalizeConnectionDiagnostic({ kind: "graphics", eventId: "abcdefgh1234", graphics: { rendererClass: "GPU", browser: "Mozilla/5.0 (X11; Linux)", renderer: "x".repeat(500) } }))
      .toMatchObject({ graphics: { browser: "Other" } });
    expect(normalizeConnectionDiagnostic({ kind: "socket-close", eventId: "abcdefgh1234", graphics: { rendererClass: "GPU" } })).not.toHaveProperty("graphics");
  });
});
