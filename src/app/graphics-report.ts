import type { ConnectionDiagnostic, ConnectionEventKind } from "../../shared/connection-diagnostics";
import { recordConnectionDiagnostic } from "../coop/services/connection-diagnostic-runtime";
import type { PerformanceSnapshot } from "../game/runtime/performance-monitor";
import { browserName, createFpsSamples, friendlyGpuName, graphicsSettingsText, osName, probeGraphics, type GraphicsProbe, type GraphicsSettingsText } from "./graphics-probe";

/** Visible play before the one "graphics" diagnostic of a session is sent. */
export const GRAPHICS_REPORT_AFTER_MS = 60_000;
/** Full-rate FPS readings it waits for, as an idle or Auto Farm player is held at 30 and gives none; sent anyway after the longest wait. */
const GRAPHICS_REPORT_SAMPLES = 10;
const GRAPHICS_REPORT_LONGEST_MS = 10 * 60_000;
const REPORTED_KEY = "wildstat:graphics-reported";

type Dependencies = {
  canvas: () => { width: number; height: number };
  snapshot: () => Pick<PerformanceSnapshot, "fps" | "workFps">;
  /** The game session is running, not on the title screen. */
  playing: () => boolean;
  /** The last frame was drawn at the 60 FPS target, not an idle or Low Performance cap. */
  fullRate: () => boolean;
  hidden: () => boolean;
  probe: () => GraphicsProbe;
  report: (kind: ConnectionEventKind, data: Partial<ConnectionDiagnostic>) => void;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  userAgent: string;
  dpr: () => number;
  /** How the world is drawing (WebGL sprites, falls back to the canvas, texture memory), for the report's detail. */
  drawing?: () => string;
};

export function createGraphicsReport(dependencies: Dependencies) {
  let probe: GraphicsProbe | null = null;
  const fps = createFpsSamples();
  let workTotal = 0; let workSamples = 0;
  let playedMs = 0; let fullRateTicks = 0;
  let reported = false;
  try { reported = dependencies.storage?.getItem(REPORTED_KEY) === "1"; } catch { /* storage blocked */ }
  const ensureProbe = () => (probe ??= dependencies.probe());

  function send() {
    reported = true;
    try { dependencies.storage?.setItem(REPORTED_KEY, "1"); } catch { /* storage blocked */ }
    const found = ensureProbe();
    const summary = fps.summary();
    const canvas = dependencies.canvas();
    dependencies.report("graphics", {
      detail: [`${found.rendererClass}; ${friendlyGpuName(found.renderer) || "unknown"}; ${summary.avg}/${summary.low} fps`, dependencies.drawing?.()].filter(Boolean).join("; "),
      graphics: { ...found, dpr: dependencies.dpr(), canvasWidth: canvas.width, canvasHeight: canvas.height,
        fpsAvg: summary.avg, fpsLow: summary.low, fpsSamples: summary.samples,
        workFps: workSamples ? Math.round(workTotal / workSamples) : 0,
        browser: browserName(dependencies.userAgent), os: osName(dependencies.userAgent) },
    });
  }

  return {
    /** Called about once a second. */
    tick(elapsedMs: number) {
      if (dependencies.hidden() || !dependencies.playing()) { fullRateTicks = 0; return; }
      playedMs += Math.max(0, Math.min(elapsedMs, 2_000));
      // The monitor averages about two seconds, so a reading counts after that long at full rate.
      fullRateTicks = dependencies.fullRate() ? fullRateTicks + 1 : 0;
      if (fullRateTicks >= 3) {
        const snapshot = dependencies.snapshot();
        fps.add(snapshot.fps);
        if (snapshot.workFps > 0) { workTotal += snapshot.workFps; workSamples += 1; }
      }
      if (!reported && playedMs >= GRAPHICS_REPORT_AFTER_MS && (fps.summary().samples >= GRAPHICS_REPORT_SAMPLES || playedMs >= GRAPHICS_REPORT_LONGEST_MS)) send();
    },
    text: (): GraphicsSettingsText => graphicsSettingsText(ensureProbe(), fps.summary()),
  };
}

/** The world's drawing as the WebGL layer counts it (world-sprite-capture.ts, webgl-sprite-pass.ts): what drew most frames, why the canvas last took over, texture memory. */
function worldDrawingNote() {
  const view = window as unknown as {
    __worldSprites?: { recorded: number; canvas: number; lastUnsupported: string };
    __worldSpriteTextures?: { count: () => number; bytes: () => number; evictions: number };
  };
  const sprites = view.__worldSprites, textures = view.__worldSpriteTextures;
  const layer = document.documentElement.dataset.worldRenderer ?? "unknown";
  if (!sprites) return `world ${layer}`;
  const frames = sprites.recorded + sprites.canvas;
  const share = frames ? Math.round(100 * sprites.recorded / frames) : 0;
  const fallback = sprites.lastUnsupported ? ` (last: ${sprites.lastUnsupported.slice(0, 40)})` : "";
  const memory = textures ? `; ${textures.count()} textures ${Math.round(textures.bytes() / 1048576)} MB, ${textures.evictions} evicted` : "";
  return `world ${layer}, sprites ${share}%${fallback}${memory}`;
}

function renderReadout(element: HTMLElement, text: GraphicsSettingsText) {
  for (const key of ["card", "drawing", "tip", "fps"] as const) {
    const line = element.querySelector<HTMLElement>(`[data-line="${key}"]`);
    if (!line) continue;
    if (line.textContent !== text[key]) line.textContent = text[key];
    line.hidden = !text[key];
  }
}

/** Samples FPS once a second, sends one diagnostic per session, and fills the Settings readout while it is open. */
export function installGraphicsReport(options: Pick<Dependencies, "canvas" | "snapshot" | "playing" | "fullRate">) {
  let storage: Dependencies["storage"] = null;
  try { storage = sessionStorage; } catch { /* storage blocked */ }
  const report = createGraphicsReport({ ...options, hidden: () => document.hidden, probe: () => probeGraphics(),
    report: (kind, data) => recordConnectionDiagnostic(kind, data), storage, userAgent: navigator.userAgent, dpr: () => window.devicePixelRatio || 1,
    drawing: worldDrawingNote });
  const refresh = () => {
    const element = document.getElementById("graphicsInfo");
    if (element && !element.closest("[hidden]")) renderReadout(element, report.text());
  };
  let last = performance.now();
  window.setInterval(() => { const now = performance.now(); report.tick(now - last); last = now; refresh(); }, 1_000);
  document.getElementById("settingsBtn")?.addEventListener("click", () => window.setTimeout(refresh, 0));
  document.getElementById("settings-game-tab")?.addEventListener("click", () => window.setTimeout(refresh, 0));
}
