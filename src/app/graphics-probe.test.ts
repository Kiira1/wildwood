import { describe, expect, it } from "vitest";
import { browserName, classifyRenderer, createFpsSamples, friendlyGpuName, graphicsSettingsText, osName, probeGraphics, SOFTWARE_TIP, type GraphicsProbe } from "./graphics-probe";

const DECK = "AMD Custom GPU 0405 (radeonsi, vangogh, LLVM 15.0.7, DRM 3.54, 6.1.52-valve16-1-neptune-61)";

describe("renderer classification", () => {
  it.each([
    ["llvmpipe (LLVM 15.0.7, 256 bits)", "Mesa"],
    ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", "Google Inc. (Google)"],
    ["softpipe", "Mesa"],
    ["ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (Microsoft)"],
    ["GDI Generic", "Microsoft Corporation"],
    ["Software Rasterizer", ""],
  ])("%s is Software", (renderer, vendor) => {
    expect(classifyRenderer(renderer, vendor, "pass")).toBe("Software");
  });
  it.each([DECK, "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Apple GPU", "Mali-G78"])("%s is GPU", renderer => {
    expect(classifyRenderer(renderer, "", "pass")).toBe("GPU");
  });
  it("a refused performance caveat is Software even with a real card name", () => {
    expect(classifyRenderer(DECK, "AMD", "fail")).toBe("Software");
  });
  it("generic strings from resistFingerprinting are Unknown", () => {
    expect(classifyRenderer("Mozilla", "Mozilla", "pass")).toBe("Unknown");
    expect(classifyRenderer("WebKit WebGL", "WebKit", "unavailable")).toBe("Unknown");
    expect(classifyRenderer("", "", "unavailable")).toBe("Unknown");
  });
});

function fakeCanvas(options: { renderer?: string; vendor?: string; webgl2?: boolean; caveatFails?: boolean; debugInfo?: boolean }) {
  const lost: string[] = [];
  const gl = (strict: boolean) => ({
    RENDERER: 1, VENDOR: 2,
    getExtension: (name: string) => name === "WEBGL_debug_renderer_info" ? (options.debugInfo === false ? null : { UNMASKED_RENDERER_WEBGL: 3, UNMASKED_VENDOR_WEBGL: 4 })
      : name === "WEBGL_lose_context" ? { loseContext: () => lost.push(strict ? "strict" : "main") } : null,
    getParameter: (key: number) => key === 3 ? options.renderer : key === 4 ? options.vendor : key === 1 ? "Mozilla" : "Mozilla",
  });
  const create = () => ({
    getContext: (kind: string, attributes?: WebGLContextAttributes) => {
      if (kind === "webgl2" && options.webgl2 === false) return null;
      if (attributes?.failIfMajorPerformanceCaveat) return options.caveatFails ? null : gl(true);
      return gl(false);
    },
  }) as unknown as HTMLCanvasElement;
  return { create, lost };
}

describe("probe", () => {
  it("reads the unmasked renderer and releases both contexts", () => {
    const canvas = fakeCanvas({ renderer: DECK, vendor: "AMD" });
    expect(probeGraphics(canvas.create)).toEqual({ rendererClass: "GPU", renderer: DECK, vendor: "AMD", masked: false, caveat: "pass", webgl: true, webgl2: true });
    expect(canvas.lost.sort()).toEqual(["main", "strict"]);
  });
  it("a failed caveat context classifies as Software", () => {
    const probe = probeGraphics(fakeCanvas({ renderer: DECK, vendor: "AMD", caveatFails: true, webgl2: false }).create);
    expect(probe).toMatchObject({ rendererClass: "Software", caveat: "fail", webgl2: false, webgl: true });
  });
  it("records a masked renderer when the browser hides it", () => {
    const probe = probeGraphics(fakeCanvas({ debugInfo: false }).create);
    expect(probe).toMatchObject({ rendererClass: "Unknown", renderer: "Mozilla", masked: true });
  });
  it("no WebGL at all is Unknown with the caveat unavailable", () => {
    const probe = probeGraphics(() => ({ getContext: () => null }) as unknown as HTMLCanvasElement);
    expect(probe).toMatchObject({ rendererClass: "Unknown", caveat: "unavailable", webgl: false, masked: false });
  });
});

describe("card names", () => {
  it.each([
    [DECK, "AMD Custom GPU 0405 (Van Gogh)"],
    ["ANGLE (AMD, AMD Custom GPU 0405 (radeonsi, vangogh, LLVM 15.0.7, DRM 3.54), OpenGL 4.6)", "AMD Custom GPU 0405 (Van Gogh)"],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)", "NVIDIA GeForce RTX 3060"],
    ["ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)", "Apple M1"],
    ["NVIDIA GeForce GTX 1060/PCIe/SSE2", "NVIDIA GeForce GTX 1060"],
    ["Mesa Intel(R) UHD Graphics 620 (KBL GT2)", "Mesa Intel(R) UHD Graphics 620 (KBL GT2)"],
    ["ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar", "NVIDIA GeForce GTX 980"],
  ])("%s", (renderer, name) => { expect(friendlyGpuName(renderer)).toBe(name); });
});

describe("Settings text", () => {
  const base: GraphicsProbe = { rendererClass: "GPU", renderer: DECK, vendor: "AMD", masked: false, caveat: "pass", webgl: true, webgl2: true };
  const fps = { avg: 58, low: 41, samples: 30 };
  it("GPU", () => {
    expect(graphicsSettingsText(base, fps)).toEqual({ card: "Graphics Card: AMD Custom GPU 0405 (Van Gogh)", drawing: "Drawing: Graphics Card", tip: "", fps: "FPS: avg 58 · low 41" });
  });
  it("CPU shows the tip", () => {
    const text = graphicsSettingsText({ ...base, rendererClass: "Software", renderer: "llvmpipe (LLVM 15.0.7, 256 bits)" }, fps);
    expect(text.drawing).toBe("Drawing: CPU (Slow)");
    expect(text.tip).toBe(SOFTWARE_TIP);
  });
  it("Unknown, masked, and before measuring", () => {
    const text = graphicsSettingsText({ ...base, rendererClass: "Unknown", renderer: "Mozilla", masked: true }, { avg: 0, low: 0, samples: 0 });
    expect(text).toEqual({ card: "Graphics Card: Hidden by Browser", drawing: "Drawing: Unknown", tip: "", fps: "FPS: Measuring…" });
    expect(graphicsSettingsText(null, fps).drawing).toBe("Drawing: Checking…");
  });
});

describe("browser and FPS summary", () => {
  it("keeps only the browser family and major version", () => {
    expect(browserName("Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0")).toBe("Firefox 158");
    expect(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0")).toBe("Edge 140");
    expect(browserName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari 18");
    expect(osName("Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0")).toBe("Linux");
  });
  it("averages and takes the 10th percentile", () => {
    const samples = createFpsSamples();
    for (let i = 0; i < 90; i++) samples.add(60);
    for (let i = 0; i < 10; i++) samples.add(20);
    expect(samples.summary()).toEqual({ avg: 56, low: 20, samples: 100 });
    samples.add(Number.NaN); samples.add(0);
    expect(samples.summary().samples).toBe(100);
  });
});
