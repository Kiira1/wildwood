/**
 * Shapes, live text and clipped groups the world draws with the 2D context's vector calls, drawn once by a
 * real 2D context into a small cached canvas and reused while they look the same. Everything is keyed in
 * device pixels relative to a whole-pixel anchor, so a shape that only moves by whole pixels keeps its canvas
 * and lands on exactly the pixels the 2D context would have drawn.
 */

export type Matrix = readonly [number, number, number, number, number, number];
export type PathCommand = { name: string; args: readonly number[]; m: Matrix };
export type GradientRecord = { kind: "linear" | "radial" | "conic"; args: readonly number[]; stops: [number, string][] };
export type PaintStyle = string | GradientRecord;
export type LineStyle = { width: number; cap: CanvasLineCap; join: CanvasLineJoin; miter: number; dash: readonly number[]; dashOffset: number };
export type Effects = { filter: string; shadowBlur: number; shadowColor: string; shadowX: number; shadowY: number };
export type TextStyle = { font: string; align: CanvasTextAlign; baseline: CanvasTextBaseline; direction: CanvasDirection; letterSpacing: string };

/** One thing a raster draws. `alpha` and `composite` are only used inside a group (a single op's go on its quad). */
export type VectorOp =
  | { type: "fill"; path: readonly PathCommand[]; rule: CanvasFillRule; style: PaintStyle; m: Matrix; alpha: number; composite: string; effects: Effects }
  | { type: "stroke"; path: readonly PathCommand[]; style: PaintStyle; line: LineStyle; m: Matrix; alpha: number; composite: string; effects: Effects }
  | { type: "text"; stroke: boolean; text: string; x: number; y: number; maxWidth?: number; style: PaintStyle; line: LineStyle;
    textStyle: TextStyle; m: Matrix; alpha: number; composite: string; effects: Effects }
  | { type: "image"; source: CanvasImageSource; args: readonly number[]; smooth: boolean; quality: ImageSmoothingQuality; m: Matrix;
    alpha: number; composite: string; effects: Effects }
  | { type: "clip"; path: readonly PathCommand[]; rule: CanvasFillRule };

export type Raster = { canvas: HTMLCanvasElement; left: number; top: number; width: number; height: number };
type Bounds = { left: number; top: number; right: number; bottom: number };

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;
function objectId(value: object) {
  let id = objectIds.get(value);
  if (!id) objectIds.set(value, id = nextObjectId++);
  return id;
}

const q = (value: number) => Math.round(value * 1024) / 1024;

function transformPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Every point a command can reach (its points, control points and the corners of its circles' boxes), in device pixels. */
function commandPoints(command: PathCommand, add: (x: number, y: number) => void) {
  const { name, args, m } = command;
  const point = (x: number, y: number) => { const [px, py] = transformPoint(m, x, y); add(px, py); };
  const box = (x: number, y: number, rx: number, ry: number, rotation = 0) => {
    const r = Math.max(Math.abs(rx), Math.abs(ry)) * (rotation ? Math.SQRT2 : 1);
    point(x - r, y - r); point(x + r, y - r); point(x - r, y + r); point(x + r, y + r);
  };
  switch (name) {
    case "moveTo": case "lineTo": point(args[0], args[1]); break;
    case "quadraticCurveTo": point(args[0], args[1]); point(args[2], args[3]); break;
    case "bezierCurveTo": point(args[0], args[1]); point(args[2], args[3]); point(args[4], args[5]); break;
    case "arcTo": point(args[0], args[1]); point(args[2], args[3]); break;
    case "arc": box(args[0], args[1], args[2], args[2]); break;
    case "ellipse": box(args[0], args[1], args[2], args[3], args[4]); break;
    case "rect": case "roundRect1": case "roundRect2": case "roundRect3": case "roundRect4": point(args[0], args[1]); point(args[0] + args[2], args[1] + args[3]); point(args[0] + args[2], args[1]); point(args[0], args[1] + args[3]); break;
    default: break;
  }
}

function blurPadding(effects: Effects) {
  let pad = 0;
  const blur = /blur\(\s*([\d.]+)px\s*\)/.exec(effects.filter);
  if (blur) pad += Number(blur[1]) * 3;
  const drop = /drop-shadow\(([^)]*)\)/.exec(effects.filter);
  if (drop) pad += 48;
  if (effects.shadowBlur > 0 || effects.shadowX || effects.shadowY) pad += effects.shadowBlur * 2 + Math.max(Math.abs(effects.shadowX), Math.abs(effects.shadowY));
  return pad;
}

function opBounds(op: VectorOp, measure: CanvasRenderingContext2D | null): Bounds | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const add = (x: number, y: number) => { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); };
  let pad = 1;
  const scaleOf = (m: Matrix) => Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
  if (op.type === "fill" || op.type === "stroke" || op.type === "clip") {
    for (const command of op.path) commandPoints(command, add);
    if (op.type === "stroke") pad += op.line.width * scaleOf(op.m) * Math.max(1, op.line.join === "miter" ? op.line.miter / 2 : 1);
  } else if (op.type === "text") {
    if (!measure) return null;
    measure.font = op.textStyle.font; measure.textAlign = op.textStyle.align; measure.textBaseline = op.textStyle.baseline;
    measure.direction = op.textStyle.direction; measure.letterSpacing = op.textStyle.letterSpacing;
    const metrics = measure.measureText(op.text);
    const size = Number.parseFloat(/([\d.]+)px/.exec(op.textStyle.font)?.[1] ?? "16");
    const width = op.maxWidth !== undefined ? Math.min(op.maxWidth, metrics.width) : metrics.width;
    const l = op.x - (metrics.actualBoundingBoxLeft || 0) - size, r = op.x + Math.max(metrics.actualBoundingBoxRight || 0, width) + size;
    const t = op.y - (metrics.actualBoundingBoxAscent || size) - size, b = op.y + (metrics.actualBoundingBoxDescent || size * .3) + size;
    for (const [x, y] of [[l, t], [r, t], [l, b], [r, b]]) { const [px, py] = transformPoint(op.m, x, y); add(px, py); }
    if (op.stroke) pad += op.line.width * scaleOf(op.m);
  } else {
    const args = op.args;
    const [dx, dy, dw, dh] = args.length === 8 ? args.slice(4) : args.length === 4 ? args : [args[0], args[1], 0, 0];
    const size = args.length === 2 ? sizeOf(op.source) : [dw, dh];
    for (const [x, y] of [[dx, dy], [dx + size[0], dy], [dx, dy + size[1]], [dx + size[0], dy + size[1]]]) { const [px, py] = transformPoint(op.m, x, y); add(px, py); }
  }
  if (op.type !== "clip") pad += blurPadding(op.effects);
  if (!Number.isFinite(left + top + right + bottom)) return null;
  return { left: left - pad, top: top - pad, right: right + pad, bottom: bottom + pad };
}

function sizeOf(source: CanvasImageSource): [number, number] {
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) return [source.naturalWidth, source.naturalHeight];
  const sized = source as { width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };
  return [typeof sized.width === "number" ? sized.width : 0, typeof sized.height === "number" ? sized.height : 0];
}

function matrixKey(m: Matrix, ox: number, oy: number) {
  return `${q(m[0])},${q(m[1])},${q(m[2])},${q(m[3])},${q(m[4] - ox)},${q(m[5] - oy)}`;
}

function styleKey(style: PaintStyle) {
  if (typeof style === "string") return style;
  return `${style.kind}(${style.args.map(q).join(",")}|${style.stops.map(([at, color]) => `${q(at)}:${color}`).join(",")})`;
}

function pathKey(path: readonly PathCommand[], ox: number, oy: number) {
  let key = "";
  let lastMatrix = "";
  for (const command of path) {
    const matrix = matrixKey(command.m, ox, oy);
    if (matrix !== lastMatrix) { key += `[${matrix}]`; lastMatrix = matrix; }
    key += `${command.name}(${command.args.map(q).join(",")})`;
  }
  return key;
}

function effectsKey(effects: Effects) {
  return `${effects.filter}|${q(effects.shadowBlur)}|${effects.shadowColor}|${q(effects.shadowX)}|${q(effects.shadowY)}`;
}

function lineKey(line: LineStyle) {
  return `${q(line.width)}|${line.cap}|${line.join}|${q(line.miter)}|${line.dash.map(q).join(",")}|${q(line.dashOffset)}`;
}

function opKey(op: VectorOp, ox: number, oy: number, inGroup: boolean): string {
  if (op.type === "clip") return `clip:${op.rule}:${pathKey(op.path, ox, oy)}`;
  const shared = `${effectsKey(op.effects)}${inGroup ? `|${q(op.alpha)}|${op.composite}` : ""}`;
  if (op.type === "fill") return `fill:${op.rule}:${styleKey(op.style)}:${matrixKey(op.m, ox, oy)}:${pathKey(op.path, ox, oy)}:${shared}`;
  if (op.type === "stroke") return `stroke:${styleKey(op.style)}:${lineKey(op.line)}:${matrixKey(op.m, ox, oy)}:${pathKey(op.path, ox, oy)}:${shared}`;
  if (op.type === "text") {
    const t = op.textStyle;
    return `text:${op.stroke ? "s" : "f"}:${op.text}:${q(op.x)},${q(op.y)},${op.maxWidth ?? ""}:${t.font}|${t.align}|${t.baseline}|${t.direction}|${t.letterSpacing}:`
      + `${styleKey(op.style)}:${op.stroke ? lineKey(op.line) : ""}:${matrixKey(op.m, ox, oy)}:${shared}`;
  }
  return `image:${objectId(op.source as object)}:${op.args.map(q).join(",")}:${op.smooth ? op.quality : "n"}:${matrixKey(op.m, ox, oy)}:${shared}`;
}

function shifted(m: Matrix, ox: number, oy: number): Matrix {
  return [m[0], m[1], m[2], m[3], m[4] - ox, m[5] - oy];
}

function paint(ctx: CanvasRenderingContext2D, style: PaintStyle) {
  if (typeof style === "string") return style;
  const gradient = style.kind === "linear" ? ctx.createLinearGradient(style.args[0], style.args[1], style.args[2], style.args[3])
    : style.kind === "radial" ? ctx.createRadialGradient(style.args[0], style.args[1], style.args[2], style.args[3], style.args[4], style.args[5])
      : ctx.createConicGradient(style.args[0], style.args[1], style.args[2]);
  for (const [at, color] of style.stops) gradient.addColorStop(at, color);
  return gradient;
}

function tracePath(ctx: CanvasRenderingContext2D, path: readonly PathCommand[], ox: number, oy: number) {
  ctx.beginPath();
  for (const command of path) {
    const m = shifted(command.m, ox, oy);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (command.name.startsWith("roundRect")) ctx.roundRect(command.args[0], command.args[1], command.args[2], command.args[3], command.args.slice(4));
    else (ctx as unknown as Record<string, (...args: number[]) => void>)[command.name](...command.args);
  }
}

function applyEffects(ctx: CanvasRenderingContext2D, effects: Effects) {
  ctx.filter = effects.filter || "none";
  ctx.shadowBlur = effects.shadowBlur;
  ctx.shadowColor = effects.shadowColor;
  ctx.shadowOffsetX = effects.shadowX;
  ctx.shadowOffsetY = effects.shadowY;
}

function drawOp(ctx: CanvasRenderingContext2D, op: VectorOp, ox: number, oy: number, inGroup: boolean) {
  if (op.type === "clip") {
    tracePath(ctx, op.path, ox, oy);
    ctx.clip(op.rule);
    return;
  }
  ctx.save();
  applyEffects(ctx, op.effects);
  ctx.globalAlpha = inGroup ? op.alpha : 1;
  ctx.globalCompositeOperation = (inGroup ? op.composite : "source-over") as GlobalCompositeOperation;
  if (op.type === "fill" || op.type === "stroke") tracePath(ctx, op.path, ox, oy);
  const m = shifted(op.m, ox, oy);
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  if (op.type === "fill") { ctx.fillStyle = paint(ctx, op.style); ctx.fill(op.rule); }
  else if (op.type === "stroke" || op.type === "text") {
    ctx.lineWidth = op.line.width; ctx.lineCap = op.line.cap; ctx.lineJoin = op.line.join; ctx.miterLimit = op.line.miter;
    ctx.setLineDash(op.line.dash as number[]); ctx.lineDashOffset = op.line.dashOffset;
    if (op.type === "stroke") { ctx.strokeStyle = paint(ctx, op.style); ctx.stroke(); }
    else {
      ctx.font = op.textStyle.font; ctx.textAlign = op.textStyle.align; ctx.textBaseline = op.textStyle.baseline;
      ctx.direction = op.textStyle.direction; ctx.letterSpacing = op.textStyle.letterSpacing;
      if (op.stroke) { ctx.strokeStyle = paint(ctx, op.style); ctx.strokeText(op.text, op.x, op.y, op.maxWidth); }
      else { ctx.fillStyle = paint(ctx, op.style); ctx.fillText(op.text, op.x, op.y, op.maxWidth); }
    }
  } else {
    ctx.imageSmoothingEnabled = op.smooth;
    ctx.imageSmoothingQuality = op.quality;
    (ctx.drawImage as (...args: unknown[]) => void)(op.source, ...op.args);
  }
  ctx.restore();
}

/** The most pixels the cache keeps, and the largest single raster (bigger ones are drawn on the canvas). */
const CACHE_PIXEL_LIMIT = 24_000_000;
const RASTER_PIXEL_LIMIT = 4_000_000;

export function createVectorRasterCache() {
  const entries = new Map<string, Raster & { pixels: number }>();
  let pixels = 0;
  const measureCanvas = typeof document === "undefined" ? null : document.createElement("canvas");
  const measure = measureCanvas?.getContext("2d") ?? null;
  const stats = { hits: 0, misses: 0, pixels: () => pixels, size: () => entries.size };

  /**
   * The canvas for `ops` (one op, or a clip group: its clip first), and where it lands in device pixels; null when
   * it covers nothing on a viewport of `width` × `height` device pixels, or is too big to cache.
   */
  function raster(ops: readonly VectorOp[], width: number, height: number): Raster | null | "too-big" {
    const group = ops.length > 1 || ops[0]?.type === "clip";
    let bounds: Bounds | null = null;
    for (const op of ops) {
      const next = opBounds(op, measure);
      if (!next) continue;
      // A group's clip bounds everything after it.
      if (op.type === "clip") { bounds = next; break; }
      bounds = bounds ? { left: Math.min(bounds.left, next.left), top: Math.min(bounds.top, next.top),
        right: Math.max(bounds.right, next.right), bottom: Math.max(bounds.bottom, next.bottom) } : next;
    }
    if (!bounds) return null;
    const left = Math.max(0, Math.floor(bounds.left)), top = Math.max(0, Math.floor(bounds.top));
    const right = Math.min(width, Math.ceil(bounds.right)), bottom = Math.min(height, Math.ceil(bounds.bottom));
    if (right <= left || bottom <= top) return null;
    const w = right - left, h = bottom - top;
    if (w * h > RASTER_PIXEL_LIMIT) return "too-big";
    let key = `${w}x${h}`;
    for (const op of ops) key += `\n${opKey(op, left, top, group)}`;
    const cached = entries.get(key);
    if (cached) {
      entries.delete(key);
      entries.set(key, cached);
      stats.hits += 1;
      return { canvas: cached.canvas, left, top, width: w, height: h };
    }
    stats.misses += 1;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    for (const op of ops) drawOp(ctx, op, left, top, group);
    const entry = { canvas, left: 0, top: 0, width: w, height: h, pixels: w * h };
    entries.set(key, entry);
    pixels += entry.pixels;
    while (pixels > CACHE_PIXEL_LIMIT && entries.size > 1) {
      const [oldestKey, oldest] = entries.entries().next().value as [string, Raster & { pixels: number }];
      entries.delete(oldestKey);
      pixels -= oldest.pixels;
    }
    return { canvas, left, top, width: w, height: h };
  }

  return { raster, stats, measure: () => measure };
}

export type VectorRasterCache = ReturnType<typeof createVectorRasterCache>;
