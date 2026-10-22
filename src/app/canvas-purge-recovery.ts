/**
 * A phone can throw away the pixels of every off-page canvas while the game is
 * in the background (Chrome loses their 2D contexts with the GPU; the canvas
 * comes back blank). The game keeps nearly all its art in such canvases (the
 * sprite sheets after their green is keyed out, every player's body, enemy
 * tints, text labels), built once and never checked, so a purge leaves an
 * invisible character and missing sprites. Rebuilding each cache is a
 * dozen separate paths; instead a sentinel canvas, made the way they are, is
 * checked on every return, and a wiped one saves and reloads the game, which
 * builds everything again. Many caches draw a bitmap frozen from their
 * canvas (frozen-canvas.ts); the sentinel stays a canvas, since a purge that
 * wipes canvases is what it watches for, and the reload rebuilds the bitmaps
 * as well. The on-page game canvas is watched too: after a GPU crash Chrome
 * can leave its context lost for good, and the game would draw every frame
 * into nothing.
 *
 * Only a sentinel read back as fully blank (all four channels zero, at several
 * points), or a game canvas still lost after LOST_GRACE_MS, counts: browsers
 * that guard against fingerprinting add noise to every canvas read, and Chrome
 * restores a passing context loss by itself. It never reloads twice inside
 * RELOAD_COOLDOWN_MS.
 */
export const SENTINEL_SIZE = 512;
const RETRY_MS = 5_000;
/** How often the watched canvases' lost flag is read: a boolean, no pixels. Chrome may never fire contextlost. */
export const WATCH_INTERVAL_MS = 1_000;
/** A game canvas lost this long, while in view, is lost for good; Chrome restores a passing loss sooner. */
export const LOST_GRACE_MS = 3_000;
/** Never reload for this more than once in this long, whatever the checks say: a loop is worse than the bug. */
export const RELOAD_COOLDOWN_MS = 5 * 60_000;
/**
 * How often the sentinel is looked at while in view. A phone restarts its graphics process under memory pressure
 * (WebKit, checked in the iOS Simulator), and Firefox after a driver fault, wiping every canvas and bitmap without
 * the page going to the background: the world then showed only its ground and freshly drawn signs.
 */
export const IN_VIEW_CHECK_MS = 5_000;
/** After a WebGL context is lost, the sentinel is read this long later, once the graphics process is back. */
const AFTER_CONTEXT_LOSS_MS = 500;
const RELOADED_AT_KEY = "wildstat:canvas-purge-reloaded-at";

type SentinelContext = Pick<CanvasRenderingContext2D, "fillRect" | "getImageData" | "clearRect"> & { fillStyle: unknown; isContextLost?: () => boolean;
  drawImage(image: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void };
type SentinelCanvas = { width: number; height: number; getContext(type: "2d", options?: { willReadFrequently?: boolean }): SentinelContext | null;
  addEventListener(type: string, listener: () => void): void };
/** The patch of the sentinel copied out for a look. */
const PROBE = 4;
type SessionStore = Pick<Storage, "getItem" | "setItem">;

/**
 * Whether the sentinel is wiped: a wiped canvas reads back as nothing at all,
 * and noise from a fingerprinting guard never reads as all zeros. A patch of
 * it is copied onto a tiny canvas kept for reading and read there: reading the
 * sentinel itself drew Chrome's "multiple readback operations" warning, and
 * marking it willReadFrequently would keep it off the GPU, where it is never
 * wiped, which is the one thing it is there to notice.
 */
function wiped(sentinel: SentinelCanvas, probe: SentinelContext) {
  try {
    probe.clearRect(0, 0, PROBE, PROBE);
    const at = (SENTINEL_SIZE - PROBE) / 2;
    probe.drawImage(sentinel, at, at, PROBE, PROBE, 0, 0, PROBE, PROBE);
    return probe.getImageData(0, 0, PROBE, PROBE).data.every(channel => channel === 0);
  } catch { return false; }
}

export function installCanvasPurgeRecovery(options: {
  /** Saves and reloads; resolves false when it could not save yet. */
  reload: () => Promise<boolean>;
  /** On-page 2D canvases whose lost context means a blank screen. */
  watch?: readonly SentinelCanvas[];
  doc?: Pick<Document, "hidden" | "addEventListener"> & { createElement(tag: "canvas"): SentinelCanvas };
  now?: () => number;
  /** Remembers the last reload across it (sessionStorage), so a reload cannot loop. */
  session?: () => SessionStore | undefined;
  /** A window event sent when a WebGL context is lost or restored (webgl-static-world-layer.ts). */
  contextEvent?: string;
  /** Says why it reloads, just before it does (a "canvas-purge" diagnostic). */
  report?: (detail: string) => void;
}) {
  const doc = options.doc ?? (document as unknown as NonNullable<typeof options.doc>);
  const now = options.now ?? (() => Date.now());
  const session = options.session ?? (() => { try { return sessionStorage; } catch { return undefined; } });
  // Large enough to be GPU-backed like the sprite sheets; a tiny canvas stays in memory and is never lost.
  const sentinel = doc.createElement("canvas");
  sentinel.width = sentinel.height = SENTINEL_SIZE;
  const context = sentinel.getContext("2d");
  if (!context) return { lost: () => false, recover: () => {} };
  context.fillStyle = "#ff00ff";
  context.fillRect(0, 0, SENTINEL_SIZE, SENTINEL_SIZE);
  const probeCanvas = doc.createElement("canvas");
  probeCanvas.width = probeCanvas.height = PROBE;
  const probe = probeCanvas.getContext("2d", { willReadFrequently: true });
  if (!probe) return { lost: () => false, recover: () => {} };
  // A browser or extension that blocks canvas reads hands back blank pixels from the start: its reads
  // prove nothing, so for this page only a lost game canvas counts (or it would reload on every return).
  const readsTrusted = !wiped(sentinel, probe);
  const watched = (options.watch ?? []).map(canvas => canvas.getContext("2d")).filter(Boolean) as SentinelContext[];
  let reloading = false, watchedLostSince: number | null = null;
  const watchedLost = () => watched.some(watchedContext => watchedContext.isContextLost?.());
  const lost = () => (watchedLostSince !== null && now() - watchedLostSince >= LOST_GRACE_MS) || (readsTrusted && wiped(sentinel, probe));
  const recentlyReloaded = () => {
    try { const at = Number(session()?.getItem(RELOADED_AT_KEY)); return Number.isFinite(at) && at > 0 && now() - at < RELOAD_COOLDOWN_MS; } catch { return false; }
  };
  let contextLostAt: number | null = null, visibleSince = now();
  /** What found it, and what the page looked like then, for the report. */
  const why = (cause: string) => {
    const nav = (typeof navigator === "undefined" ? {} : navigator) as { deviceMemory?: number; userAgent?: string };
    const heap = (typeof performance === "undefined" ? undefined : (performance as { memory?: { usedJSHeapSize: number } }).memory)?.usedJSHeapSize;
    const world = typeof document === "undefined" ? "" : document.documentElement?.dataset?.worldRenderer ?? "";
    return [cause, watchedLostSince !== null ? "game canvas lost" : "sentinel wiped",
      contextLostAt !== null ? `context lost ${Math.round((now() - contextLostAt) / 1000)}s ago` : "no context loss",
      `in view ${Math.round((now() - visibleSince) / 1000)}s`, world && `world ${world}`,
      nav.deviceMemory ? `device ${nav.deviceMemory} GB` : "", heap ? `heap ${Math.round(heap / 1048576)} MB` : ""].filter(Boolean).join("; ");
  };
  const recover = (cause = "return") => {
    if (reloading || doc.hidden || recentlyReloaded() || !lost()) return;
    reloading = true;
    try { options.report?.(why(cause)); } catch { /* The reload matters more than the report. */ }
    try { session()?.setItem(RELOADED_AT_KEY, String(now())); } catch { /* The cooldown then lasts this page only. */ }
    // Not saved, not reloaded: the cooldown is for reloads that happen, so the retry may go ahead.
    const retry = () => { try { session()?.setItem(RELOADED_AT_KEY, "0"); } catch { /* No cooldown was kept. */ }
      setTimeout(() => { reloading = false; recover(cause); }, RETRY_MS); };
    void options.reload().then(done => { if (!done) retry(); }, retry);
  };
  doc.addEventListener("visibilitychange", () => { if (!doc.hidden) visibleSince = now(); recover("return"); });
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", () => recover("return"));
    if (options.contextEvent) window.addEventListener(options.contextEvent, () => {
      contextLostAt = now();
      setTimeout(() => recover("context lost"), AFTER_CONTEXT_LOSS_MS);
    });
  }
  setInterval(() => { if (!doc.hidden) recover("in view"); }, IN_VIEW_CHECK_MS);
  // After a GPU crash Chrome left the game canvas lost without firing contextlost (checked in headless Chrome).
  if (watched.length) setInterval(() => {
    if (doc.hidden) return;
    if (!watchedLost()) { watchedLostSince = null; return; }
    watchedLostSince ??= now();
    recover("game canvas");
  }, WATCH_INTERVAL_MS);
  return { lost, recover };
}
