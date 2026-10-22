import type { GraphicsClass, GraphicsDiagnostic } from "../../shared/connection-diagnostics";

export type GraphicsProbe = Pick<GraphicsDiagnostic, "rendererClass" | "renderer" | "vendor" | "masked" | "caveat" | "webgl" | "webgl2">;

const SOFTWARE = /llvmpipe|lavapipe|softpipe|swiftshader|swrast|software|basic render driver|microsoft basic|gdi generic/i;
// Firefox's resistFingerprinting and browsers without the debug extension report these.
const GENERIC = /^(?:mozilla|webkit|webkit webgl|generic renderer|google inc\.?|apple inc\.?|)$/i;

export function isGenericRenderer(renderer: string) { return GENERIC.test(renderer.trim()); }

export function classifyRenderer(renderer: string, vendor: string, caveat: GraphicsProbe["caveat"]): GraphicsClass {
  if (caveat === "fail" || SOFTWARE.test(renderer) || SOFTWARE.test(vendor)) return "Software";
  return isGenericRenderer(renderer) ? "Unknown" : "GPU";
}

type GL = WebGLRenderingContext | WebGL2RenderingContext;
type CanvasFactory = () => Pick<HTMLCanvasElement, "getContext">;

function release(gl: GL | null) { try { gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* best effort */ } }
function context(create: CanvasFactory, kind: "webgl2" | "webgl", attributes: WebGLContextAttributes = {}): GL | null {
  try { return create().getContext(kind, attributes) as GL | null; } catch { return null; }
}

/** Reads the WebGL renderer once on throwaway contexts, which are released after. */
export function probeGraphics(create: CanvasFactory = () => document.createElement("canvas")): GraphicsProbe {
  const gl2 = context(create, "webgl2");
  const gl = gl2 ?? context(create, "webgl");
  let renderer = ""; let vendor = "";
  if (gl) {
    try {
      // Firefox names the card in RENDERER and warns that the debug extension is going; Chrome names it only there.
      renderer = String(gl.getParameter(gl.RENDERER) || "");
      vendor = String(gl.getParameter(gl.VENDOR) || "");
      if (isGenericRenderer(renderer)) {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || renderer);
        if (info && isGenericRenderer(vendor)) vendor = String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL) || vendor);
      }
    } catch { /* keeps what was read */ }
  }
  // A context that refuses a major performance caveat is a software one.
  let caveat: GraphicsProbe["caveat"] = "unavailable";
  if (gl) {
    const strict = context(create, gl2 ? "webgl2" : "webgl", { failIfMajorPerformanceCaveat: true });
    caveat = strict ? "pass" : "fail";
    release(strict);
  }
  release(gl);
  renderer = renderer.trim(); vendor = vendor.trim();
  return { rendererClass: classifyRenderer(renderer, vendor, caveat), renderer, vendor, masked: Boolean(gl) && isGenericRenderer(renderer),
    caveat, webgl: Boolean(gl), webgl2: Boolean(gl2) };
}

const CHIP_NAMES: Record<string, string> = { vangogh: "Van Gogh", rembrandt: "Rembrandt", phoenix: "Phoenix", renoir: "Renoir", raphael: "Raphael" };
const DRIVER_PART = /^(?:radeonsi|r600|amdgpu|iris|i915|crocus|nouveau|nvc0|zink|panfrost|freedreno|v3d|mesa|llvm|drm|gfx|opengl|vulkan|direct3d|d3d)|^0x[0-9a-f]+$|\d+\.\d+/i;

/** A readable card name from a WebGL renderer string, without driver and API details. */
export function friendlyGpuName(renderer: string) {
  let name = renderer.trim().replace(/,\s*or similar$/i, "");
  const angle = /^ANGLE \((.*)\)$/.exec(name);
  if (angle) {
    // ANGLE (Vendor, Device (details), API): the device is the middle part.
    const parts: string[] = []; let depth = 0; let start = 0;
    for (let i = 0; i < angle[1].length; i += 1) {
      const c = angle[1][i];
      if (c === "(") depth += 1; else if (c === ")") depth -= 1;
      else if (c === "," && depth === 0) { parts.push(angle[1].slice(start, i)); start = i + 1; }
    }
    parts.push(angle[1].slice(start));
    name = (parts.length >= 2 ? parts[1] : parts[0]).trim();
  }
  name = name.replace(/^ANGLE Metal Renderer:\s*/i, "").replace(/\/PCIe.*$|\/SSE2.*$/i, "").replace(/\s+(?:Direct3D|D3D|vs_|OpenGL|Metal).*$/i, "");
  name = name.replace(/\s*\(([^()]*)\)\s*$/, (_, inner: string) => {
    const chip = inner.split(",").map(part => part.trim()).find(part => part && !DRIVER_PART.test(part));
    return chip ? ` (${CHIP_NAMES[chip.toLowerCase()] ?? chip})` : "";
  });
  name = name.replace(/\s+/g, " ").trim();
  return name.length > 48 ? `${name.slice(0, 47)}…` : name;
}

export type GraphicsSettingsText = { card: string; drawing: string; tip: string; fps: string };
export const SOFTWARE_TIP = "Your browser isn't using your graphics card. In Firefox: about:support → Compositing; on Steam Deck run flatpak update.";

/** The Settings readout. Null probe means it has not run yet. */
export function graphicsSettingsText(probe: GraphicsProbe | null, fps: { avg: number; low: number; samples: number }): GraphicsSettingsText {
  const card = !probe ? "Checking…" : !probe.webgl ? "Unavailable" : probe.masked ? "Hidden by Browser" : friendlyGpuName(probe.renderer) || "Unknown";
  const drawing = !probe ? "Checking…" : probe.rendererClass === "GPU" ? "Graphics Card" : probe.rendererClass === "Software" ? "CPU (Slow)" : "Unknown";
  return {
    card: `Graphics Card: ${card}`, drawing: `Drawing: ${drawing}`,
    tip: probe?.rendererClass === "Software" ? SOFTWARE_TIP : "",
    fps: fps.samples > 0 ? `FPS: avg ${fps.avg} · low ${fps.low}` : "FPS: Measuring…",
  };
}

/** Browser family and major version only, never the full user agent. */
export function browserName(userAgent: string) {
  // Most specific first: Edge and Opera also say Chrome.
  for (const [token, name] of [["Edg", "Edge"], ["OPR", "Opera"], ["SamsungBrowser", "Samsung"], ["Firefox", "Firefox"], ["FxiOS", "Firefox"], ["CriOS", "Chrome"], ["Chrome", "Chrome"]]) {
    const match = new RegExp(`\\b${token}/(\\d+)`).exec(userAgent);
    if (match) return `${name} ${match[1]}`;
  }
  const safari = /Version\/(\d+).*Safari\//.exec(userAgent);
  return safari ? `Safari ${safari[1]}` : "Other";
}

export function osName(userAgent: string) {
  return /android/i.test(userAgent) ? "Android" : /iphone|ipad|ipod/i.test(userAgent) ? "iOS" : /CrOS/.test(userAgent) ? "ChromeOS"
    : /windows/i.test(userAgent) ? "Windows" : /mac os x/i.test(userAgent) ? "macOS" : /linux/i.test(userAgent) ? "Linux" : "Other";
}

/** Session FPS as a histogram: average and 10th percentile without keeping every sample. */
export function createFpsSamples() {
  const counts = new Uint32Array(241);
  let total = 0; let samples = 0;
  return {
    add(fps: number) {
      if (!Number.isFinite(fps) || fps <= 0) return;
      const value = Math.min(240, Math.round(fps));
      counts[value] += 1; total += value; samples += 1;
    },
    summary() {
      if (!samples) return { avg: 0, low: 0, samples: 0 };
      const target = Math.ceil(samples * .1);
      let seen = 0; let low = 0;
      for (let value = 0; value < counts.length; value += 1) { seen += counts[value]; if (seen >= target) { low = value; break; } }
      return { avg: Math.round(total / samples), low, samples };
    },
  };
}
