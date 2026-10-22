import {
  createVectorRasterCache, type Effects, type GradientRecord, type LineStyle, type Matrix, type PaintStyle, type PathCommand, type VectorOp,
} from "./vector-raster-cache";

/**
 * Stands in for the game's 2D context while the world is drawn, and turns what it draws into textured quads for
 * the WebGL world layer, in the order they were drawn. Images become quads of their own texture. Shapes, live text
 * and clipped groups are drawn once by a real 2D context into cached canvases (vector-raster-cache.ts) and become
 * quads of those. What it cannot reproduce (reading pixels back, clearing, other blend modes) throws
 * SpriteRecorderUnsupported, and the frame is drawn on the 2D canvas instead.
 */

export type SpriteSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;
export type SpriteBlend = "normal" | "add";
/**
 * Consecutive quads drawn with one texture, filter, blend and clip. A null source is a solid colour. `radial` is null for
 * an image, or a radial gradient's inner radius as a share of its outer one: the source is then its colour ramp.
 * `ring` is a solid circle or ring the shader draws: its inner radius as a share of its outer one, and one device
 * pixel in the same units. `scissor` is a clip rectangle in device pixels (left, top, right, bottom), or null.
 */
export type SpriteBatch = {
  source: SpriteSource | null; smooth: boolean; blend: SpriteBlend; radial: number | null; ring: readonly [number, number] | null;
  scissor: readonly number[] | null; first: number; count: number;
};

/** Floats per vertex: device x, y, texture u, v, and a premultiplied colour multiplier r, g, b, a. */
export const SPRITE_VERTEX_FLOATS = 8;
const QUAD_FLOATS = SPRITE_VERTEX_FLOATS * 4;
/** The most quads one frame records: what the WebGL pass can index in one buffer. */
const MAX_RECORDED_QUADS = 16_384;

export class SpriteRecorderUnsupported extends Error {
  constructor(readonly operation: string) { super(`World sprite recorder cannot draw ${operation}`); }
}

type State = {
  a: number; b: number; c: number; d: number; e: number; f: number;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  globalCompositeOperation: GlobalCompositeOperation;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  filter: string;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  direction: CanvasDirection;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  lineDashOffset: number;
  lineDash: number[];
  imageSmoothingQuality: ImageSmoothingQuality;
  letterSpacing: string;
  /** A rectangle clip the GPU's scissor test applies, in device pixels: left, top, right, bottom. */
  scissor: readonly number[] | null;
};

const COPIED_PROPERTIES = [
  "globalAlpha", "imageSmoothingEnabled", "globalCompositeOperation", "fillStyle", "strokeStyle", "filter", "shadowBlur",
  "shadowColor", "shadowOffsetX", "shadowOffsetY", "font", "textAlign", "textBaseline", "direction", "lineWidth", "lineCap",
  "lineJoin", "miterLimit", "lineDashOffset", "imageSmoothingQuality", "letterSpacing",
] as const;

/** Calls only a real 2D context can make. */
const UNSUPPORTED_METHODS = ["clearRect", "putImageData", "getImageData", "isPointInPath", "isPointInStroke", "drawFocusIfNeeded", "reset"] as const;

const colorCache = new Map<string, readonly [number, number, number, number] | null>();
let colorProbe: CanvasRenderingContext2D | null | undefined;

/** A CSS colour as straight r, g, b, a in 0..1, or null for anything that is not one solid colour. */
export function parseSolidColor(style: string): readonly [number, number, number, number] | null {
  const cached = colorCache.get(style);
  if (cached !== undefined) return cached;
  let parsed: readonly [number, number, number, number] | null = null;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(style);
  if (hex && [3, 4, 6, 8].includes(hex[1].length)) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map(digit => digit + digit).join("") : hex[1];
    const value = (index: number) => Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16) / 255;
    parsed = [value(0), value(1), value(2), digits.length === 8 ? value(3) : 1];
  } else {
    // The browser normalises any other colour to #rrggbb or rgba(...).
    if (colorProbe === undefined) colorProbe = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (colorProbe) {
      colorProbe.fillStyle = "#000";
      colorProbe.fillStyle = style;
      const normal = colorProbe.fillStyle;
      const rgba = /^rgba?\(([^)]+)\)$/.exec(normal);
      if (normal.startsWith("#")) parsed = parseSolidColor(normal);
      else if (rgba) {
        const parts = rgba[1].split(",").map(part => Number.parseFloat(part));
        parsed = [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] ?? 1];
      }
    }
  }
  if (colorCache.size > 256) colorCache.clear();
  colorCache.set(style, parsed);
  return parsed;
}

function sourceSize(source: SpriteSource): [number, number] {
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    return source.complete ? [source.naturalWidth, source.naturalHeight] : [0, 0];
  }
  return [source.width, source.height];
}

const isWhole = (value: number) => Math.abs(value - Math.round(value)) < 1e-6;

const ramps = new Map<string, HTMLCanvasElement>();
/** A gradient's colours along 256 pixels, drawn by a 2D context so they blend exactly as the canvas blends them. */
function rampFor(stops: readonly [number, string][]) {
  const key = stops.map(([at, color]) => `${at}:${color}`).join("|");
  let ramp = ramps.get(key);
  if (ramp) return ramp;
  ramp = document.createElement("canvas");
  ramp.width = 256;
  ramp.height = 1;
  const paint = ramp.getContext("2d");
  if (paint) {
    const gradient = paint.createLinearGradient(0, 0, 256, 0);
    for (const [at, color] of stops) gradient.addColorStop(at, color);
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, 256, 1);
  }
  if (ramps.size >= 64) ramps.clear();
  ramps.set(key, ramp);
  return ramp;
}

/** A radial gradient with both circles on one centre, the outer bigger: what the WebGL shader draws itself. */
function concentric(style: PaintStyle): (GradientRecord & { kind: "radial" }) | null {
  if (typeof style === "string" || style.kind !== "radial" || !style.stops.length) return null;
  const [x0, y0, r0, x1, y1, r1] = style.args;
  return x0 === x1 && y0 === y1 && r1 > 0 && r0 >= 0 && r0 < r1 ? style as GradientRecord & { kind: "radial" } : null;
}

export type SpriteRecording = { vertices: Float32Array; quads: number; batches: readonly SpriteBatch[] };

/** Gradients made while recording: real ones, so they work anywhere, with their stops noted for the raster cache. */
const gradientRecords = new WeakMap<CanvasGradient, GradientRecord>();

export function createSpriteRecorder(measure: () => CanvasRenderingContext2D | null) {
  const rasters = createVectorRasterCache();
  let vertices = new Float32Array(QUAD_FLOATS * 256);
  let quads = 0;
  const batches: SpriteBatch[] = [];
  let batchCount = 0;
  let canvas: HTMLCanvasElement | null = null;
  let state = blankState();
  const stack: State[] = [];
  const pool: State[] = [];
  /** The current path, in the order its commands came, each with the transform it came under. Not part of save(). */
  let path: PathCommand[] = [];
  /** A clip and everything drawn under it, rastered together when the save it was made in is restored. */
  let group: { ops: VectorOp[]; depth: number; scissor: readonly number[] | null } | null = null;

  function blankState(): State {
    return {
      a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, globalAlpha: 1, imageSmoothingEnabled: false, globalCompositeOperation: "source-over",
      fillStyle: "#000", strokeStyle: "#000", filter: "none", shadowBlur: 0, shadowColor: "rgba(0, 0, 0, 0)", shadowOffsetX: 0,
      shadowOffsetY: 0, font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic", direction: "inherit", lineWidth: 1,
      lineCap: "butt", lineJoin: "miter", miterLimit: 10, lineDashOffset: 0, lineDash: [], imageSmoothingQuality: "low", letterSpacing: "0px",
      scissor: null,
    };
  }

  const defaults = blankState();

  function copyState(into: State, from: State) {
    Object.assign(into, from);
    into.lineDash = from.lineDash;
    return into;
  }

  // Kept even when a drawing function catches the throw itself, so a partly recorded frame is never drawn.
  let failure: SpriteRecorderUnsupported | null = null;
  function unsupported(operation: string): never {
    throw failure ??= new SpriteRecorderUnsupported(operation);
  }

  const matrix = (): Matrix => [state.a, state.b, state.c, state.d, state.e, state.f];

  function blendNow(): SpriteBlend {
    const operation = state.globalCompositeOperation;
    if (operation === "source-over") return "normal";
    if (operation === "lighter") return "add";
    return unsupported(`globalCompositeOperation ${operation}`);
  }

  function effects(): Effects {
    return { filter: state.filter, shadowBlur: state.shadowBlur, shadowColor: state.shadowColor, shadowX: state.shadowOffsetX, shadowY: state.shadowOffsetY };
  }

  function hasEffects() {
    if (state.filter !== "none" && state.filter !== "") return true;
    if (state.shadowBlur > 0 || state.shadowOffsetX !== 0 || state.shadowOffsetY !== 0) {
      const shadow = parseSolidColor(state.shadowColor);
      return !shadow || shadow[3] > 0;
    }
    return false;
  }

  function line(): LineStyle {
    return { width: state.lineWidth, cap: state.lineCap, join: state.lineJoin, miter: state.miterLimit, dash: state.lineDash, dashOffset: state.lineDashOffset };
  }

  function paintStyle(style: string | CanvasGradient | CanvasPattern): PaintStyle {
    if (typeof style === "string") return style;
    const record = gradientRecords.get(style as CanvasGradient);
    return record ? { ...record, stops: [...record.stops] } : unsupported("a pattern or foreign gradient");
  }

  /** Adds one quad in device pixels (the transform already applied to its corners). */
  function pushCorners(source: SpriteSource | null, smooth: boolean, blend: SpriteBlend,
    x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
    u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, alpha: number,
    radial: number | null = null, uv?: readonly number[], ring: readonly [number, number] | null = null) {
    if (quads >= MAX_RECORDED_QUADS) unsupported("more sprites than one frame holds");
    const scissor = state.scissor;
    let batch = batchCount > 0 ? batches[batchCount - 1] : undefined;
    if (!batch || batch.source !== source || batch.blend !== blend || batch.radial !== radial || (source !== null && batch.smooth !== smooth)
      || batch.scissor !== scissor || batch.ring?.[0] !== ring?.[0] || batch.ring?.[1] !== ring?.[1]) {
      batch = batches[batchCount] ?? (batches[batchCount] = { source, smooth, blend, radial, ring, scissor, first: quads, count: 0 });
      batch.source = source; batch.smooth = smooth; batch.blend = blend; batch.radial = radial; batch.ring = ring; batch.scissor = scissor;
      batch.first = quads; batch.count = 0;
      batchCount += 1;
    }
    if ((quads + 1) * QUAD_FLOATS > vertices.length) {
      const grown = new Float32Array(vertices.length * 2);
      grown.set(vertices);
      vertices = grown;
    }
    // Premultiplied: textures are premultiplied, so the colour scales with the alpha.
    const pr = r * alpha, pg = g * alpha, pb = b * alpha;
    let cursor = quads * QUAD_FLOATS;
    const corner = (x: number, y: number, u: number, v: number) => {
      vertices[cursor++] = x; vertices[cursor++] = y; vertices[cursor++] = u; vertices[cursor++] = v;
      vertices[cursor++] = pr; vertices[cursor++] = pg; vertices[cursor++] = pb; vertices[cursor++] = alpha;
    };
    if (uv) {
      corner(x0, y0, uv[0], uv[1]);
      corner(x1, y1, uv[2], uv[3]);
      corner(x2, y2, uv[4], uv[5]);
      corner(x3, y3, uv[6], uv[7]);
    } else {
      corner(x0, y0, u0, v0);
      corner(x1, y1, u1, v0);
      corner(x2, y2, u0, v1);
      corner(x3, y3, u1, v1);
    }
    quads += 1;
    batch.count += 1;
  }

  /** A quad for a rectangle in the current user space. */
  function pushQuad(source: SpriteSource | null, smooth: boolean, x: number, y: number, w: number, h: number,
    u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, alpha: number) {
    const { a, b: mb, c, d, e, f } = state;
    const px = (cx: number, cy: number) => a * cx + c * cy + e, py = (cx: number, cy: number) => mb * cx + d * cy + f;
    pushCorners(source, smooth, blendNow(), px(x, y), py(x, y), px(x + w, y), py(x + w, y), px(x, y + h), py(x, y + h), px(x + w, y + h), py(x + w, y + h),
      u0, v0, u1, v1, r, g, b, alpha);
  }

  /** A rectangle in user space filled with a concentric radial gradient, drawn by the shader: no raster at all. */
  function pushRadial(gradient: GradientRecord & { kind: "radial" }, x: number, y: number, w: number, h: number) {
    const alpha = state.globalAlpha;
    if (!(alpha > 0)) return;
    const [cx, cy, r0, , , r1] = gradient.args;
    const { a, b: mb, c, d, e, f } = state;
    const px = (ux: number, uy: number) => a * ux + c * uy + e, py = (ux: number, uy: number) => mb * ux + d * uy + f;
    const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    const uv = corners.flatMap(([ux, uy]) => [(ux - cx) / r1, (uy - cy) / r1]);
    pushCorners(rampFor(gradient.stops), true, blendNow(),
      px(x, y), py(x, y), px(x + w, y), py(x + w, y), px(x, y + h), py(x, y + h), px(x + w, y + h), py(x + w, y + h),
      0, 0, 1, 1, 1, 1, 1, alpha, r0 / r1, uv);
  }

  /** A path that is one whole circle under the current transform, filled with a gradient fading out on its own edge. */
  function radialCircle(style: PaintStyle) {
    const gradient = concentric(style);
    if (!gradient || path.length !== 1 || hasEffects() || group) return null;
    const [arc] = path;
    const [cx, cy, radius, start, end] = arc.args;
    const current = matrix();
    const lastStop = gradient.stops[gradient.stops.length - 1][1];
    const fadesOut = parseSolidColor(lastStop)?.[3] === 0;
    if (arc.name !== "arc" || !fadesOut || Math.abs(end - start) < Math.PI * 2 - 1e-6) return null;
    if (arc.m.some((value, index) => value !== current[index])) return null;
    if (gradient.args[0] !== cx || gradient.args[1] !== cy || Math.abs(gradient.args[5] - radius) > 1e-6) return null;
    return { gradient, cx, cy, radius };
  }

  /**
   * A path that is one whole circle, round under the transform it was made in (any rotation, one scale, mirrored
   * or not): what the shader draws at any size, so a ring that grows each frame needs no new raster.
   */
  function roundCircle() {
    if (path.length !== 1 || group || hasEffects()) return null;
    const [shape] = path;
    let cx: number, cy: number, radius: number, start: number, end: number;
    if (shape.name === "arc") [cx, cy, radius, start, end] = shape.args;
    else if (shape.name === "ellipse" && shape.args[2] === shape.args[3]) [cx, cy, radius, , , start, end] = shape.args;
    else return null;
    if (!(radius > 0) || Math.abs(end - start) < Math.PI * 2 - 1e-6) return null;
    const [a, b, c, d] = shape.m;
    const scale = Math.hypot(a, b);
    if (!(scale > 0) || Math.abs(Math.hypot(c, d) - scale) > scale * 1e-6 || Math.abs(a * c + b * d) > scale * scale * 1e-6) return null;
    return { cx, cy, radius, m: shape.m, scale };
  }

  /** A solid circle (inner 0) or ring between two radii around a round circle's centre, drawn by the shader. */
  function pushRing(circle: NonNullable<ReturnType<typeof roundCircle>>, inner: number, outer: number, color: readonly number[]) {
    const alpha = color[3] * state.globalAlpha;
    if (!(alpha > 0) || !(outer > 0)) return;
    const { cx, cy, m: [a, b, c, d, e, f] } = circle;
    // One device pixel past the edge, for its antialiased fringe.
    const reach = outer + 1 / circle.scale;
    const px = (ux: number, uy: number) => a * ux + c * uy + e, py = (ux: number, uy: number) => b * ux + d * uy + f;
    const x0 = cx - reach, y0 = cy - reach, x1 = cx + reach, y1 = cy + reach, edge = reach / outer;
    pushCorners(null, false, blendNow(), px(x0, y0), py(x0, y0), px(x1, y0), py(x1, y0), px(x0, y1), py(x0, y1), px(x1, y1), py(x1, y1),
      0, 0, 1, 1, color[0], color[1], color[2], alpha, null, [-edge, -edge, edge, -edge, -edge, edge, edge, edge],
      [Math.max(0, inner) / outer, 1 / (outer * circle.scale)]);
  }

  /** Draws a vector op: into the open clip group, or rastered on its own as one quad. */
  function drawVector(op: VectorOp) {
    if (group) {
      if (op.type !== "clip" && op.composite !== "source-over") unsupported(`${op.composite} under a clip`);
      group.ops.push(op);
      return;
    }
    const alpha = op.type === "clip" ? 1 : op.alpha;
    if (!(alpha > 0)) return;
    const blend = blendNow();
    pushRaster([op], blend, alpha);
  }

  function pushRaster(ops: VectorOp[], blend: SpriteBlend, alpha: number) {
    const target = canvas ?? { width: 0, height: 0 };
    const raster = rasters.raster(ops, target.width, target.height);
    if (raster === "too-big") unsupported("a shape too big to cache");
    if (!raster) return;
    const { left, top, width, height } = raster;
    pushCorners(raster.canvas, false, blend, left, top, left + width, top, left, top + height, left + width, top + height, 0, 0, 1, 1, 1, 1, 1, alpha);
  }

  function closeGroup() {
    if (!group) return;
    const { ops, scissor } = group;
    group = null;
    if (ops.length <= 1) return;
    // Under the rectangle clip it was opened in, which the restore that closes it may have dropped.
    const current = state.scissor;
    state.scissor = scissor;
    pushRaster(ops, "normal", 1);
    state.scissor = current;
  }

  function addPath(name: string, args: number[]) {
    for (const value of args) if (!Number.isFinite(value)) return;
    path.push({ name, args, m: matrix() });
  }

  function drawImage(source: CanvasImageSource, ...args: number[]) {
    if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) unsupported("drawImage of a video");
    if (typeof SVGImageElement !== "undefined" && source instanceof SVGImageElement) unsupported("drawImage of an SVG image");
    if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) unsupported("drawImage of a video frame");
    const sprite = source as SpriteSource;
    const [width, height] = sourceSize(sprite);
    if (!(width > 0) || !(height > 0)) return;
    if (args.length !== 2 && args.length !== 4 && args.length !== 8) throw new TypeError("drawImage takes 3, 5 or 9 arguments");
    if (group || hasEffects()) {
      drawVector({ type: "image", source, args: [...args], smooth: state.imageSmoothingEnabled, quality: state.imageSmoothingQuality,
        m: matrix(), alpha: state.globalAlpha, composite: state.globalCompositeOperation, effects: effects() });
      return;
    }
    let sx = 0, sy = 0, sw = width, sh = height, dx: number, dy: number, dw: number, dh: number;
    if (args.length === 2) [dx, dy] = args, dw = width, dh = height;
    else if (args.length === 4) [dx, dy, dw, dh] = args;
    else [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    if (!sw || !sh || !dw || !dh || !Number.isFinite(dx + dy + dw + dh + sx + sy + sw + sh)) return;
    // Like the 2D context, a source rectangle running off the image draws only the part on it.
    if (sw < 0) { sx += sw; sw = -sw; }
    if (sh < 0) { sy += sh; sh = -sh; }
    const left = Math.max(0, sx), top = Math.max(0, sy), right = Math.min(width, sx + sw), bottom = Math.min(height, sy + sh);
    if (right <= left || bottom <= top) return;
    if (left !== sx || top !== sy || right !== sx + sw || bottom !== sy + sh) {
      const scaleX = dw / sw, scaleY = dh / sh;
      dx += (left - sx) * scaleX; dy += (top - sy) * scaleY;
      dw = (right - left) * scaleX; dh = (bottom - top) * scaleY;
      sx = left; sy = top; sw = right - left; sh = bottom - top;
    }
    const alpha = state.globalAlpha;
    if (!(alpha > 0)) return;
    pushQuad(sprite, state.imageSmoothingEnabled, dx, dy, dw, dh, sx / width, sy / height, (sx + sw) / width, (sy + sh) / height, 1, 1, 1, alpha);
  }

  function fillRect(x: number, y: number, w: number, h: number) {
    if (!w || !h || !Number.isFinite(x + y + w + h)) return;
    const style = state.fillStyle;
    const color = typeof style === "string" ? parseSolidColor(style) : null;
    const { a, b, c, d, e, f } = state;
    // A solid rectangle on whole device pixels is one quad; anything else is drawn as the 2D context would, with its edges.
    if (color && !group && !hasEffects() && b === 0 && c === 0
      && isWhole(a * x + e) && isWhole(d * y + f) && isWhole(a * (x + w) + e) && isWhole(d * (y + h) + f)) {
      const alpha = color[3] * state.globalAlpha;
      if (alpha > 0) pushQuad(null, false, x, y, w, h, 0, 0, 1, 1, color[0], color[1], color[2], alpha);
      return;
    }
    const paint = paintStyle(style);
    const gradient = concentric(paint);
    if (gradient && !group && !hasEffects()) { pushRadial(gradient, x, y, w, h); return; }
    drawVector({ type: "fill", path: [{ name: "rect", args: [x, y, w, h], m: matrix() }], rule: "nonzero", style: paint,
      m: matrix(), alpha: state.globalAlpha, composite: state.globalCompositeOperation, effects: effects() });
  }

  function setTransform(a?: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number) {
    if (a === undefined) { state.a = 1; state.b = 0; state.c = 0; state.d = 1; state.e = 0; state.f = 0; return; }
    if (typeof a === "object") {
      state.a = a.a ?? a.m11 ?? 1; state.b = a.b ?? a.m12 ?? 0; state.c = a.c ?? a.m21 ?? 0;
      state.d = a.d ?? a.m22 ?? 1; state.e = a.e ?? a.m41 ?? 0; state.f = a.f ?? a.m42 ?? 0;
      return;
    }
    state.a = a; state.b = b!; state.c = c!; state.d = d!; state.e = e!; state.f = f!;
  }

  function transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    const s = state;
    const na = s.a * a + s.c * b, nb = s.b * a + s.d * b;
    const nc = s.a * c + s.c * d, nd = s.b * c + s.d * d;
    const ne = s.a * e + s.c * f + s.e, nf = s.b * e + s.d * f + s.f;
    s.a = na; s.b = nb; s.c = nc; s.d = nd; s.e = ne; s.f = nf;
  }

  function fillRule(value: unknown): CanvasFillRule {
    if (typeof value === "object" && value !== null) unsupported("a Path2D");
    return value === "evenodd" ? "evenodd" : "nonzero";
  }

  function text(stroke: boolean, value: string, x: number, y: number, maxWidth?: number) {
    if (!Number.isFinite(x + y)) return;
    drawVector({ type: "text", stroke, text: String(value), x, y, maxWidth, style: paintStyle(stroke ? state.strokeStyle : state.fillStyle), line: line(),
      textStyle: { font: state.font, align: state.textAlign, baseline: state.textBaseline, direction: state.direction, letterSpacing: state.letterSpacing },
      m: matrix(), alpha: state.globalAlpha, composite: state.globalCompositeOperation, effects: effects() });
  }

  function gradient(kind: GradientRecord["kind"], args: number[]) {
    const probe = measure();
    if (!probe) return unsupported("a gradient");
    const made = kind === "linear" ? probe.createLinearGradient(args[0], args[1], args[2], args[3])
      : kind === "radial" ? probe.createRadialGradient(args[0], args[1], args[2], args[3], args[4], args[5])
        : probe.createConicGradient(args[0], args[1], args[2]);
    const record: GradientRecord = { kind, args, stops: [] };
    gradientRecords.set(made, record);
    const addColorStop = made.addColorStop.bind(made);
    made.addColorStop = (offset: number, color: string) => { addColorStop(offset, color); record.stops.push([offset, color]); };
    return made;
  }

  const context: Record<string, unknown> = {
    get canvas() { return canvas; },
    save() { stack.push(copyState(pool.pop() ?? blankState(), state)); },
    restore() {
      const saved = stack.pop();
      if (!saved) return;
      pool.push(state);
      state = saved;
      if (group && stack.length < group.depth) closeGroup();
    },
    translate(x: number, y: number) { state.e += state.a * x + state.c * y; state.f += state.b * x + state.d * y; },
    scale(x: number, y: number) { state.a *= x; state.b *= x; state.c *= y; state.d *= y; },
    rotate(angle: number) { const cos = Math.cos(angle), sin = Math.sin(angle); transform(cos, sin, -sin, cos, 0, 0); },
    transform,
    setTransform,
    resetTransform() { setTransform(); },
    getTransform() { return new DOMMatrix([state.a, state.b, state.c, state.d, state.e, state.f]); },
    drawImage,
    fillRect,
    strokeRect(x: number, y: number, w: number, h: number) {
      if (!Number.isFinite(x + y + w + h)) return;
      drawVector({ type: "stroke", path: [{ name: "rect", args: [x, y, w, h], m: matrix() }], style: paintStyle(state.strokeStyle), line: line(),
        m: matrix(), alpha: state.globalAlpha, composite: state.globalCompositeOperation, effects: effects() });
    },
    beginPath() { path = []; },
    closePath() { path.push({ name: "closePath", args: [], m: matrix() }); },
    moveTo: (x: number, y: number) => addPath("moveTo", [x, y]),
    lineTo: (x: number, y: number) => addPath("lineTo", [x, y]),
    quadraticCurveTo: (...args: number[]) => addPath("quadraticCurveTo", args),
    bezierCurveTo: (...args: number[]) => addPath("bezierCurveTo", args),
    arcTo: (...args: number[]) => addPath("arcTo", args),
    rect: (...args: number[]) => addPath("rect", args),
    arc(x: number, y: number, radius: number, start: number, end: number, counterclockwise = false) { addPath("arc", [x, y, radius, start, end, counterclockwise ? 1 : 0]); },
    ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, counterclockwise = false) {
      addPath("ellipse", [x, y, rx, ry, rotation, start, end, counterclockwise ? 1 : 0]);
    },
    roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0) {
      const list = typeof radii === "number" ? [radii] : Array.isArray(radii) && radii.every(value => typeof value === "number") ? radii : unsupported("roundRect radii");
      addPath(`roundRect${list.length}`, [x, y, w, h, ...list]);
    },
    fill(rule?: unknown) {
      const glow = radialCircle(paintStyle(state.fillStyle));
      if (glow) { pushRadial(glow.gradient, glow.cx - glow.radius, glow.cy - glow.radius, glow.radius * 2, glow.radius * 2); return; }
      const circle = roundCircle();
      const color = circle && typeof state.fillStyle === "string" ? parseSolidColor(state.fillStyle) : null;
      if (circle && color) { pushRing(circle, 0, circle.radius, color); return; }
      drawVector({ type: "fill", path: [...path], rule: fillRule(rule), style: paintStyle(state.fillStyle), m: matrix(), alpha: state.globalAlpha,
        composite: state.globalCompositeOperation, effects: effects() });
    },
    stroke(pathArgument?: unknown) {
      if (pathArgument !== undefined) unsupported("a Path2D");
      // The line's width is in the transform it is stroked in, so only one that matches the circle's.
      const circle = roundCircle(), now = matrix();
      const color = circle && typeof state.strokeStyle === "string" && !state.lineDash.length && state.lineWidth > 0
        && circle.m.every((value, index) => value === now[index]) ? parseSolidColor(state.strokeStyle) : null;
      if (circle && color) { pushRing(circle, circle.radius - state.lineWidth / 2, circle.radius + state.lineWidth / 2, color); return; }
      drawVector({ type: "stroke", path: [...path], style: paintStyle(state.strokeStyle), line: line(), m: matrix(), alpha: state.globalAlpha,
        composite: state.globalCompositeOperation, effects: effects() });
    },
    clip(rule?: unknown) {
      const op: VectorOp = { type: "clip", path: [...path], rule: fillRule(rule) };
      if (group) unsupported("a clip inside a clip");
      // A rectangle on the screen's axes is the GPU's scissor test: what is drawn under it stays quads.
      const [shape] = path;
      if (path.length === 1 && shape.name === "rect" && shape.m[1] === 0 && shape.m[2] === 0) {
        const [a, , , d, e, f] = shape.m, [x, y, w, h] = shape.args;
        const xs = [a * x + e, a * (x + w) + e], ys = [d * y + f, d * (y + h) + f];
        const outer = state.scissor ?? [-Infinity, -Infinity, Infinity, Infinity];
        const left = Math.max(outer[0], Math.round(Math.min(...xs))), top = Math.max(outer[1], Math.round(Math.min(...ys)));
        state.scissor = [left, top, Math.max(left, Math.min(outer[2], Math.round(Math.max(...xs)))), Math.max(top, Math.min(outer[3], Math.round(Math.max(...ys))))];
        return;
      }
      group = { ops: [op], depth: stack.length, scissor: state.scissor };
    },
    fillText: (value: string, x: number, y: number, maxWidth?: number) => text(false, value, x, y, maxWidth),
    strokeText: (value: string, x: number, y: number, maxWidth?: number) => text(true, value, x, y, maxWidth),
    setLineDash(segments: number[]) { state.lineDash = [...segments]; },
    getLineDash() { return [...state.lineDash]; },
    measureText(value: string) {
      const probe = measure();
      if (!probe) return unsupported("measureText");
      probe.font = state.font; probe.direction = state.direction; probe.letterSpacing = state.letterSpacing;
      return probe.measureText(value);
    },
    createLinearGradient: (...args: number[]) => gradient("linear", args),
    createRadialGradient: (...args: number[]) => gradient("radial", args),
    createConicGradient: (...args: number[]) => gradient("conic", args),
    createPattern(image: CanvasImageSource, repetition: string | null) { return measure()?.createPattern(image, repetition) ?? unsupported("createPattern"); },
    getContextAttributes() { return { alpha: true, desynchronized: false, colorSpace: "srgb", willReadFrequently: false }; },
    isContextLost() { return false; },
  };
  for (const name of UNSUPPORTED_METHODS) context[name] = () => unsupported(name);
  for (const name of COPIED_PROPERTIES) {
    Object.defineProperty(context, name, {
      get: () => state[name],
      set: (value: never) => {
        // Like the 2D context, values it would reject leave the property as it was.
        if (name === "globalAlpha" && !(Number(value) >= 0 && Number(value) <= 1)) return;
        (state as Record<string, unknown>)[name] = value;
      },
      enumerable: true,
    });
  }

  return {
    context: context as unknown as CanvasRenderingContext2D,
    /** Starts a recording that continues from `from`'s transform and drawing state. */
    begin(from: CanvasRenderingContext2D) {
      quads = 0; batchCount = 0; stack.length = 0; failure = null; path = []; group = null;
      canvas = from.canvas;
      const current = from.getTransform();
      setTransform(current.a, current.b, current.c, current.d, current.e, current.f);
      // A property the browser lacks (WebKit has no filter) keeps its default: undefined read as a filter on every draw.
      for (const name of COPIED_PROPERTIES) (state as Record<string, unknown>)[name] = from[name] ?? defaults[name];
      state.lineDash = from.getLineDash();
      state.scissor = null;
    },
    /** The first call it could not record this frame, if any. */
    failure: () => failure,
    finish(): SpriteRecording {
      closeGroup();
      return { vertices, quads, batches: batches.slice(0, batchCount) };
    },
    rasterStats: rasters.stats,
  };
}

export type SpriteRecorder = ReturnType<typeof createSpriteRecorder>;
