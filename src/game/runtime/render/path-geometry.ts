import type { Matrix, PathCommand } from "./vector-raster-cache";

/**
 * A 2D context path turned into outlines in device pixels, for the WebGL world layer to fill through the stencil
 * buffer (NanoVG's method) instead of rastering a canvas: a shape that grows, moves or spins each frame costs
 * the same as one that stands still. An outline is a closed polygon, x and y in turn. `inner` marks the edges
 * (from point i to the next) that lie inside a stroke where its pieces meet: those get no soft edge.
 */
export type Outline = { points: number[]; inner?: boolean[] };
/** `loop` when the subpath is one whole arc: open, but its ends meet heading the same way. */
export type Subpath = { points: number[]; closed: boolean; loop?: boolean };
/** `pixels` is how many device pixels a unit of its space spans at most, for how finely round joins and caps are cut. */
export type StrokeStyle = {
  halfWidth: number; cap: CanvasLineCap; join: CanvasLineJoin; miterLimit: number; dash: readonly number[]; dashOffset: number; pixels?: number;
};

const TAU = Math.PI * 2;
/** How far a flattened curve may stray from the true one, in device pixels. */
const TOLERANCE = .25;

function scaleOf(m: Matrix) {
  return Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
}

/** Segments for an arc of `sweep` radians at `radius` device pixels. */
function arcSteps(radius: number, sweep: number, tolerance = TOLERANCE) {
  const step = radius <= tolerance ? Math.PI / 4 : Math.min(Math.PI / 4, 2 * Math.acos(1 - tolerance / radius));
  return Math.max(1, Math.ceil(Math.abs(sweep) / step));
}

/** The canvas's sweep from `start` to `end`: a whole turn when asked for one or more, otherwise under one. */
function arcSweep(start: number, end: number, counterclockwise: boolean) {
  if (!counterclockwise) {
    if (end - start >= TAU) return TAU;
    const sweep = (end - start) % TAU;
    return sweep < 0 ? sweep + TAU : sweep;
  }
  if (start - end >= TAU) return -TAU;
  const sweep = (start - end) % TAU;
  return -(sweep < 0 ? sweep + TAU : sweep);
}

/**
 * The path's subpaths in device pixels, each command placed by the transform it was made under; null for one it
 * cannot follow. A dashed stroke asks for a finer `tolerance`: its dashes are measured along the flattened line.
 */
export function flattenPath(path: readonly PathCommand[], tolerance = TOLERANCE): Subpath[] | null {
  const subpaths: Subpath[] = [];
  let current: Subpath | null = null;
  const begin = (x: number, y: number) => { current = { points: [x, y], closed: false }; subpaths.push(current); };
  const lineTo = (x: number, y: number) => {
    if (!current) { begin(x, y); return; }
    current.points.push(x, y);
    current.loop = false;
  };
  const last = (): [number, number] | null => current ? [current.points[current.points.length - 2], current.points[current.points.length - 1]] : null;
  /** Closes the subpath; what comes next starts a new one where it began. */
  const close = () => {
    if (!current) return;
    const closing: Subpath = current;
    closing.closed = true;
    begin(closing.points[0], closing.points[1]);
  };

  function arc(m: Matrix, cx: number, cy: number, rx: number, ry: number, rotation: number, start: number, sweep: number, join: boolean) {
    const steps = arcSteps(Math.max(Math.abs(rx), Math.abs(ry)) * scaleOf(m), sweep, tolerance);
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    let fresh = !join || current === null;
    for (let step = 0; step <= steps; step += 1) {
      const angle = start + sweep * step / steps;
      const ux = Math.cos(angle) * rx, uy = Math.sin(angle) * ry;
      const x = cx + ux * cos - uy * sin, y = cy + ux * sin + uy * cos;
      const dx = m[0] * x + m[2] * y + m[4], dy = m[1] * x + m[3] * y + m[5];
      if (step === 0) {
        const at = last();
        // A subpath begun just where this arc starts is still this arc alone.
        if (!fresh && at && current && (current as Subpath).points.length === 2 && Math.abs(at[0] - dx) < 1e-6 && Math.abs(at[1] - dy) < 1e-6) fresh = true;
        if (fresh) begin(dx, dy); else lineTo(dx, dy);
      } else lineTo(dx, dy);
    }
    if (fresh && Math.abs(sweep) >= TAU - 1e-9) (current as Subpath | null)!.loop = true;
  }

  function curve(m: Matrix, controls: number[]) {
    if (!current) begin(m[0] * controls[0] + m[2] * controls[1] + m[4], m[1] * controls[0] + m[3] * controls[1] + m[5]);
    const [sx, sy] = last()!;
    const device = [sx, sy];
    for (let index = 0; index < controls.length; index += 2) {
      device.push(m[0] * controls[index] + m[2] * controls[index + 1] + m[4], m[1] * controls[index] + m[3] * controls[index + 1] + m[5]);
    }
    let length = 0;
    for (let index = 2; index < device.length; index += 2) length += Math.hypot(device[index] - device[index - 2], device[index + 1] - device[index - 1]);
    const steps = Math.min(128, Math.max(1, Math.ceil(Math.sqrt(length / tolerance) / 2)));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps, u = 1 - t;
      if (device.length === 6) {
        lineTo(u * u * device[0] + 2 * u * t * device[2] + t * t * device[4], u * u * device[1] + 2 * u * t * device[3] + t * t * device[5]);
      } else {
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        lineTo(a * device[0] + b * device[2] + c * device[4] + d * device[6], a * device[1] + b * device[3] + c * device[5] + d * device[7]);
      }
    }
  }

  /** A rounded rectangle's outline, its radii per corner (top left, top right, bottom right, bottom left) as the canvas reads them. */
  function roundRect(m: Matrix, x: number, y: number, w: number, h: number, list: readonly number[]) {
    if (list.length < 1 || list.length > 4 || list.some(value => !(value >= 0))) return false;
    const [tl, tr, br, bl] = list.length === 1 ? [list[0], list[0], list[0], list[0]]
      : list.length === 2 ? [list[0], list[1], list[0], list[1]]
        : list.length === 3 ? [list[0], list[1], list[2], list[1]]
          : list;
    // Radii that overlap along a side are scaled down together, as the canvas does.
    const width = Math.abs(w), height = Math.abs(h);
    const scale = Math.min(1, width / (tl + tr || 1), width / (bl + br || 1), height / (tl + bl || 1), height / (tr + br || 1));
    const sx = Math.sign(w) || 1, sy = Math.sign(h) || 1;
    const corners: [number, number, number, number][] = [
      [x + sx * tl * scale, y + sy * tl * scale, tl * scale, Math.PI],
      [x + w - sx * tr * scale, y + sy * tr * scale, tr * scale, Math.PI * 1.5],
      [x + w - sx * br * scale, y + h - sy * br * scale, br * scale, 0],
      [x + sx * bl * scale, y + h - sy * bl * scale, bl * scale, Math.PI / 2],
    ];
    corners.forEach(([cx, cy, radius, start], index) => {
      const begun = index > 0;
      if (radius > 0) arc(m, cx, cy, radius * sx, radius * sy, 0, start, Math.PI / 2, begun);
      else { const dx = m[0] * cx + m[2] * cy + m[4], dy = m[1] * cx + m[3] * cy + m[5]; if (begun) lineTo(dx, dy); else begin(dx, dy); }
    });
    close();
    begin(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    return true;
  }

  for (const command of path) {
    const { name, args, m } = command;
    if (name === "moveTo") begin(m[0] * args[0] + m[2] * args[1] + m[4], m[1] * args[0] + m[3] * args[1] + m[5]);
    else if (name === "lineTo") lineTo(m[0] * args[0] + m[2] * args[1] + m[4], m[1] * args[0] + m[3] * args[1] + m[5]);
    else if (name === "closePath") close();
    else if (name === "arc") {
      const [cx, cy, radius, start, end, counterclockwise] = args;
      if (radius < 0) return null;
      arc(m, cx, cy, radius, radius, 0, start, arcSweep(start, end, counterclockwise === 1), current !== null);
    } else if (name === "ellipse") {
      const [cx, cy, rx, ry, rotation, start, end, counterclockwise] = args;
      if (rx < 0 || ry < 0) return null;
      arc(m, cx, cy, rx, ry, rotation, start, arcSweep(start, end, counterclockwise === 1), current !== null);
    } else if (name === "quadraticCurveTo") curve(m, [args[0], args[1], args[2], args[3]]);
    else if (name === "bezierCurveTo") curve(m, [args[0], args[1], args[2], args[3], args[4], args[5]]);
    else if (name === "rect") {
      const [x, y, w, h] = args;
      const corner = (cx: number, cy: number) => [m[0] * cx + m[2] * cy + m[4], m[1] * cx + m[3] * cy + m[5]] as const;
      begin(...corner(x, y));
      lineTo(...corner(x + w, y)); lineTo(...corner(x + w, y + h)); lineTo(...corner(x, y + h));
      close();
    } else if (name.startsWith("roundRect")) {
      const [x, y, w, h, ...radii] = args;
      if (!roundRect(m, x, y, w, h, radii)) return null;
    } else if (name === "arcTo") {
      if (!arcTo(m, args)) return null;
    } else return null;
  }
  return subpaths;

  /** The canvas's arcTo: a line to where a circle of the radius touches both lines, then round the corner. */
  function arcTo(m: Matrix, [x1, y1, x2, y2, radius]: readonly number[]) {
    if (radius < 0) return false;
    if (!current) { begin(m[0] * x1 + m[2] * y1 + m[4], m[1] * x1 + m[3] * y1 + m[5]); return true; }
    const determinant = m[0] * m[3] - m[1] * m[2];
    if (!determinant) return false;
    const [dx, dy] = last()!;
    // The current point, back in the user space the corner is given in.
    const rx = dx - m[4], ry = dy - m[5];
    const x0 = (m[3] * rx - m[2] * ry) / determinant, y0 = (-m[1] * rx + m[0] * ry) / determinant;
    const ax = x0 - x1, ay = y0 - y1, bx = x2 - x1, by = y2 - y1;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const cross = ax * by - ay * bx;
    if (!la || !lb || !radius || Math.abs(cross) < 1e-9 * la * lb) { lineTo(m[0] * x1 + m[2] * y1 + m[4], m[1] * x1 + m[3] * y1 + m[5]); return true; }
    const cos = (ax * bx + ay * by) / (la * lb);
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    const reach = radius / Math.tan(angle / 2);
    const tx = x1 + ax / la * reach, ty = y1 + ay / la * reach;
    const ex = x1 + bx / lb * reach, ey = y1 + by / lb * reach;
    const bisectorX = ax / la + bx / lb, bisectorY = ay / la + by / lb, bisector = Math.hypot(bisectorX, bisectorY);
    const distance = radius / Math.sin(angle / 2);
    const cx = x1 + bisectorX / bisector * distance, cy = y1 + bisectorY / bisector * distance;
    const start = Math.atan2(ty - cy, tx - cx);
    let sweep = Math.atan2(ey - cy, ex - cx) - start;
    if (sweep > Math.PI) sweep -= TAU;
    if (sweep < -Math.PI) sweep += TAU;
    arc(m, cx, cy, radius, radius, 0, start, sweep, true);
    return true;
  }
}

/** A fill's outlines: every subpath with an area, closed. */
export function fillOutlines(subpaths: readonly Subpath[]): Outline[] {
  return subpaths.map(subpath => dedupe(subpath.points, true)).filter(points => points.length >= 6).map(points => ({ points }));
}

/** Points with each repeat of the one before dropped (and, closed, the last when it is the first again). */
function dedupe(points: readonly number[], closed: boolean) {
  const out: number[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index], y = points[index + 1];
    if (out.length && Math.abs(out[out.length - 2] - x) < 1e-6 && Math.abs(out[out.length - 1] - y) < 1e-6) continue;
    out.push(x, y);
  }
  if (closed && out.length >= 4 && Math.abs(out[0] - out[out.length - 2]) < 1e-6 && Math.abs(out[1] - out[out.length - 1]) < 1e-6) out.length -= 2;
  return out;
}

/** Twice-signed area halved: positive when the outline winds so that (-dy, dx) along each edge points inside. */
export function signedArea(points: readonly number[]) {
  let area = 0;
  for (let index = 0, count = points.length; index < count; index += 2) {
    const next = (index + 2) % count;
    area += points[index] * points[next + 1] - points[next] * points[index + 1];
  }
  return area / 2;
}

function reverse(outline: Outline): Outline {
  const points: number[] = [];
  for (let index = outline.points.length - 2; index >= 0; index -= 2) points.push(outline.points[index], outline.points[index + 1]);
  // Edge i ran from point i to i + 1; reversed, it runs from point n - 2 - i to n - 1 - i.
  const inner = outline.inner;
  if (!inner) return { points };
  const count = inner.length;
  return { points, inner: inner.map((_, index) => inner[(count - 2 - index + count) % count]) };
}

/** The same outline turned to wind the positive way, so overlapping pieces of one stroke add up. */
function positive(outline: Outline) {
  return signedArea(outline.points) >= 0 ? outline : reverse(outline);
}

function circle(x: number, y: number, radius: number, pixels = 1): Outline {
  const steps = arcSteps(radius * pixels, TAU), points: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    const angle = step / steps * TAU;
    points.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  return { points };
}

/** The open runs a dash pattern leaves of a polyline, in device pixels. */
function dashRuns(points: readonly number[], closed: boolean, dash: readonly number[], offset: number) {
  const pattern = dash.length % 2 ? [...dash, ...dash] : dash;
  const period = pattern.reduce((sum, value) => sum + value, 0);
  const runs: number[][] = [];
  const all = closed ? [...points, points[0], points[1]] : points;
  // Where in the pattern the path starts.
  let phase = ((offset % period) + period) % period, index = 0;
  while (phase >= pattern[index]) { phase -= pattern[index]; index = (index + 1) % pattern.length; }
  let on = index % 2 === 0, left = pattern[index] - phase;
  const startsOn = on;
  let run: number[] | null = on ? [all[0], all[1]] : null;
  for (let at = 2; at < all.length; at += 2) {
    let x0 = all[at - 2], y0 = all[at - 1];
    const x1 = all[at], y1 = all[at + 1];
    let length = Math.hypot(x1 - x0, y1 - y0);
    while (length > left) {
      const t = left / length;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (on) { run!.push(x, y); runs.push(run!); run = null; } else run = [x, y];
      on = !on;
      length -= left; x0 = x; y0 = y;
      index = (index + 1) % pattern.length;
      left = pattern[index];
    }
    left -= length;
    if (on) run!.push(x1, y1);
  }
  // A dash running over a closed path's start is one dash, as the canvas draws it.
  if (closed && run && startsOn && runs.length) runs[0] = [...run, ...runs[0].slice(2)];
  else if (run && run.length >= 4) runs.push(run);
  return runs;
}

/**
 * A stroke's outlines: convex pieces whose union is the stroke. A run of gentle turns is a band of quads, mitred
 * between them; a sharp turn ends it with a join piece.
 */
export function strokeOutlines(subpaths: readonly Subpath[], style: StrokeStyle): Outline[] {
  const pieces: Outline[] = [];
  const dashed = style.dash.length > 0 && style.dash.every(value => value >= 0 && Number.isFinite(value)) && style.dash.some(value => value > 0);
  for (const subpath of subpaths) {
    const closed = subpath.closed || subpath.loop === true;
    const points = dedupe(subpath.points, closed);
    if (points.length < 4) continue;
    if (dashed) for (const run of dashRuns(points, closed, style.dash, style.dashOffset)) strokePolyline(dedupe(run, false), false, style, pieces);
    else strokePolyline(points, closed, style, pieces);
  }
  return pieces;
}

function strokePolyline(points: readonly number[], closed: boolean, style: StrokeStyle, pieces: Outline[]) {
  const count = points.length / 2;
  if (count < 2) return;
  const hw = style.halfWidth;
  const segments = closed ? count : count - 1;
  const dx: number[] = [], dy: number[] = [], lengths: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % count;
    const x = points[next * 2] - points[index * 2], y = points[next * 2 + 1] - points[index * 2 + 1];
    const length = Math.hypot(x, y);
    dx.push(x / length); dy.push(y / length); lengths.push(length);
  }
  // A vertex between segments `index - 1` and `index` is gentle when a mitred band through it cannot fold.
  const gentle = (vertex: number) => {
    const previous = (vertex - 1 + segments) % segments;
    const dot = dx[previous] * dx[vertex] + dy[previous] * dy[vertex];
    if (dot < .88) return false;
    const halfTurn = Math.acos(Math.min(1, dot)) / 2;
    return hw * Math.tan(halfTurn) <= Math.min(lengths[previous], lengths[vertex]) / 2;
  };
  const offsetAt = (vertex: number, segment: number, mitred: boolean): [number, number] => {
    if (!mitred) return [-dy[segment] * hw, dx[segment] * hw];
    const previous = (vertex - 1 + segments) % segments;
    const nx = -dy[previous] - dy[segment], ny = dx[previous] + dx[segment];
    const scale = hw / (1 + dx[previous] * dx[segment] + dy[previous] * dy[segment]);
    return [nx * scale, ny * scale];
  };

  const sharp: number[] = [];
  for (let vertex = closed ? 0 : 1; vertex < (closed ? count : count - 1); vertex += 1) if (!gentle(vertex)) sharp.push(vertex);

  // Quads between cross-sections; a cross edge is inside the stroke unless it is the line's own end.
  const band = (left: readonly number[], right: readonly number[], wrap: boolean, startEdge: boolean, endEdge: boolean) => {
    const sections = left.length / 2, quads = wrap ? sections : sections - 1;
    for (let quad = 0; quad < quads; quad += 1) {
      const a = quad * 2, z = ((quad + 1) % sections) * 2;
      pieces.push(positive({
        points: [left[a], left[a + 1], left[z], left[z + 1], right[z], right[z + 1], right[a], right[a + 1]],
        inner: [false, wrap || quad < quads - 1 || !endEdge, false, wrap || quad > 0 || !startEdge],
      }));
    }
  };

  if (closed && sharp.length === 0) {
    const left: number[] = [], right: number[] = [];
    for (let vertex = 0; vertex < count; vertex += 1) {
      const [ox, oy] = offsetAt(vertex, vertex, true);
      left.push(points[vertex * 2] + ox, points[vertex * 2 + 1] + oy);
      right.push(points[vertex * 2] - ox, points[vertex * 2 + 1] - oy);
    }
    band(left, right, true, false, false);
    return;
  }

  // Bands from one sharp vertex (or end) to the next.
  const stops = closed ? sharp : [0, ...sharp, count - 1];
  const bands = closed ? stops.length : stops.length - 1;
  for (let index = 0; index < bands; index += 1) {
    const from = stops[index], to = closed ? stops[(index + 1) % stops.length] : stops[index + 1];
    const left: number[] = [], right: number[] = [];
    let vertex = from;
    for (let steps = 0; ; steps += 1) {
      const atStart = vertex === from && steps === 0, atEnd = vertex === to && steps > 0;
      const segment = atEnd ? (vertex - 1 + segments) % segments : vertex % segments;
      const [ox, oy] = offsetAt(vertex, segment, !atStart && !atEnd);
      let x = points[vertex * 2], y = points[vertex * 2 + 1];
      // A square cap reaches past the line's end by half its width.
      if (!closed && style.cap === "square" && ((atStart && vertex === 0) || (atEnd && vertex === count - 1))) {
        const sign = atStart ? -1 : 1;
        x += dx[segment] * hw * sign; y += dy[segment] * hw * sign;
      }
      left.push(x + ox, y + oy); right.push(x - ox, y - oy);
      if (atEnd) break;
      vertex = (vertex + 1) % count;
    }
    band(left, right, false, !closed && from === 0, !closed && to === count - 1);
  }

  for (const vertex of sharp) pieces.push(...joinPieces(points, vertex, segments, dx, dy, style));
  if (!closed && style.cap === "round") {
    pieces.push(circle(points[0], points[1], hw, style.pixels), circle(points[(count - 1) * 2], points[(count - 1) * 2 + 1], hw, style.pixels));
  }
}

/** What fills the outside of a sharp turn: a disc, a mitre or a bevel, as the line's join asks. */
function joinPieces(points: readonly number[], vertex: number, segments: number, dx: readonly number[], dy: readonly number[], style: StrokeStyle): Outline[] {
  const hw = style.halfWidth;
  const x = points[vertex * 2], y = points[vertex * 2 + 1];
  if (style.join === "round") return [circle(x, y, hw, style.pixels)];
  const previous = (vertex - 1 + segments) % segments, next = vertex % segments;
  const n0x = -dy[previous], n0y = dx[previous], n1x = -dy[next], n1y = dx[next];
  // The turn bends toward the inside; the join fills the other side.
  const towardInside = (n0x + n1x) * (dx[next] - dx[previous]) + (n0y + n1y) * (dy[next] - dy[previous]);
  const side = towardInside > 0 ? -1 : 1;
  const ax = x + n0x * hw * side, ay = y + n0y * hw * side, bx = x + n1x * hw * side, by = y + n1y * hw * side;
  const dot = dx[previous] * dx[next] + dy[previous] * dy[next];
  const cosHalf = Math.sqrt(Math.max(0, (1 + dot) / 2));
  if (style.join === "miter" && cosHalf > 1e-6 && 1 / cosHalf <= style.miterLimit) {
    const scale = hw / (1 + dot) * side;
    return [positive({ points: [x, y, ax, ay, x + (n0x + n1x) * scale, y + (n0y + n1y) * scale, bx, by], inner: [true, false, false, true] })];
  }
  return [positive({ points: [x, y, ax, ay, bx, by], inner: [true, false, true] })];
}
