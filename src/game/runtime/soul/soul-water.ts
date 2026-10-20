import { decodedImage } from "../render/decoded-image";
import { TOWN_EAST_BRIDGE } from "../../../../shared/town";
import { SOUL_VILLAGE_GROUND } from "../../soul-village";
import { SOUL_WATER_CELLS } from "./soul-water-cells";
import type { Camera } from "../render/camera";

export const SOUL_WATER_SOURCE = "assets/wildstat/soul-dimension/village-water.webp";
export const SOUL_SHORE_SOURCE = "assets/wildstat/soul-dimension/village-shore.webp";

export const GLINT_TILE = 192;
/** The water's map: which squares of this many of the masks' pixels hold any water or foam. */
const WATER_CELL_PIXELS = 32;
/** The light's layer grows in steps of this many pixels, so a drifting view does not resize it every frame. */
const LAYER_STEP = 256;
/** The layer's edges snap out to this grid (world units), so walking does not move them every frame. */
const LAYER_GRID = 128;
/** How often the glints are relit: they drift about a unit each time and fade slowly, so steps do not show. */
export const RELIGHT_SECONDS = 1 / 8;
/** How strongly the glints show over the water. */
export const GLINT_STRENGTH = .3;
/** The two glint layers' drift, world units a second. */
export const GLINT_DRIFT = [[9, 3], [-6, 5]] as const;

/** How strongly a glint layer shows at a moment: each fades in and out at its own pace. */
export function glintStrength(t: number, index: number) {
  return .55 + .45 * Math.sin(t * (1.1 + index * .7) + index * 2);
}

/** The shore's foam, breathing. */
export function foamStrength(t: number) {
  return .35 + .2 * Math.sin(t * 1.4);
}

/** Which cells of the village's ground hold water or foam, and where that grid lies in the world. */
export type WaterCells = {
  columns: number;
  rows: number;
  /** One per cell, row by row: 1 where there is water or foam. */
  wet: Uint8Array;
  area: { x: number; y: number; w: number; h: number };
  /** A cell's size in world units: the masks' last column and row of cells run past their edge. */
  cellW: number;
  cellH: number;
};

/** Marks the cells with any coverage in the masks' alpha (RGBA rows, `width` pixels across). */
export function waterCellsFromAlpha(alpha: Uint8ClampedArray, width: number, height: number, area: WaterCells["area"], cellPixels = WATER_CELL_PIXELS): WaterCells {
  const columns = Math.ceil(width / cellPixels), rows = Math.ceil(height / cellPixels);
  const wet = new Uint8Array(columns * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cellPixels) * columns;
    for (let x = 0; x < width; x++) if (alpha[(y * width + x) * 4 + 3] > 0) wet[row + Math.floor(x / cellPixels)] = 1;
  }
  return { columns, rows, wet, area, cellW: area.w / width * cellPixels, cellH: area.h / height * cellPixels };
}

/**
 * The smallest world rectangle, inside the view, that holds every bit of water or foam in view; null when
 * none is in view (on the square, most of the time), so the water costs nothing there.
 */
export function waterRectInView(cells: WaterCells, view: { left: number; top: number; right: number; bottom: number }) {
  const { area, columns, rows, wet, cellW, cellH } = cells;
  const c0 = Math.max(0, Math.floor((view.left - area.x) / cellW)), c1 = Math.min(columns - 1, Math.floor((view.right - area.x) / cellW));
  const r0 = Math.max(0, Math.floor((view.top - area.y) / cellH)), r1 = Math.min(rows - 1, Math.floor((view.bottom - area.y) / cellH));
  let minC = Infinity, maxC = -1, minR = Infinity, maxR = -1;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (!wet[r * columns + c]) continue;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
  }
  if (maxC < 0) return null;
  const left = Math.max(view.left, area.x + minC * cellW), right = Math.min(view.right, area.x + (maxC + 1) * cellW);
  const top = Math.max(view.top, area.y + minR * cellH), bottom = Math.min(view.bottom, area.y + (maxR + 1) * cellH);
  return left < right && top < bottom ? { left, top, right, bottom } : null;
}

/**
 * The water in view row by row: for each row of cells, the span from its first wet cell to its last, clipped to
 * the view. The river curls round the village, so its bounding box is most of the screen while the water in it is
 * a band; only these rows' spans are lit and laid. Nothing outside them has any water or foam to show.
 */
export function waterRowsInView(cells: WaterCells, view: { left: number; top: number; right: number; bottom: number }) {
  const { area, columns, rows, wet, cellW, cellH } = cells;
  const c0 = Math.max(0, Math.floor((view.left - area.x) / cellW)), c1 = Math.min(columns - 1, Math.floor((view.right - area.x) / cellW));
  const r0 = Math.max(0, Math.floor((view.top - area.y) / cellH)), r1 = Math.min(rows - 1, Math.floor((view.bottom - area.y) / cellH));
  const spans: { left: number; top: number; right: number; bottom: number }[] = [];
  for (let r = r0; r <= r1; r++) {
    let minC = -1, maxC = -1;
    for (let c = c0; c <= c1; c++) if (wet[r * columns + c]) { if (minC < 0) minC = c; maxC = c; }
    if (minC < 0) continue;
    // Whole units, so a span's edge never cuts a pixel of the light's layer in two.
    const left = Math.floor(Math.max(view.left, area.x + minC * cellW)), right = Math.ceil(Math.min(view.right, area.x + (maxC + 1) * cellW));
    const top = Math.floor(Math.max(view.top, area.y + r * cellH)), bottom = Math.ceil(Math.min(view.bottom, area.y + (r + 1) * cellH));
    if (left >= right || top >= bottom) continue;
    // A row with the same span as the one above joins it.
    const last = spans[spans.length - 1];
    if (last && last.left === left && last.right === right && last.bottom === top) last.bottom = bottom;
    else spans.push({ left, top, right, bottom });
  }
  return spans;
}

/** Short soft strokes, like light catching ripples: tiled, they read as a moving surface. Drawn `size` pixels across. */
export function glintTile(seed: number, size = GLINT_TILE) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.scale(size / GLINT_TILE, size / GLINT_TILE);
  let state = seed;
  const random = () => { state = (state * 1_103_515_245 + 12_345) >>> 0; return state / 4_294_967_296; };
  context.strokeStyle = "#ffffff";
  context.lineCap = "round";
  for (let i = 0; i < 16; i++) {
    const x = random() * GLINT_TILE, y = random() * GLINT_TILE, length = 8 + random() * 16;
    context.globalAlpha = .45 + random() * .55;
    context.lineWidth = 1.5 + random() * 1.5;
    context.beginPath();
    context.moveTo(x - length / 2, y);
    context.quadraticCurveTo(x, y - 3, x + length / 2, y);
    context.stroke();
  }
  return canvas;
}

/** The baked table of where the water is (bake-water-cells.mjs), as cells over the village's ground. */
export function waterCellsFromBits(table: { width: number; height: number; cellPixels: number; bits: string }, area: WaterCells["area"]): WaterCells {
  const columns = Math.ceil(table.width / table.cellPixels), rows = Math.ceil(table.height / table.cellPixels);
  const bytes = Uint8Array.from(atob(table.bits), character => character.charCodeAt(0));
  const wet = new Uint8Array(columns * rows);
  for (let cell = 0; cell < wet.length; cell++) wet[cell] = (bytes[cell >> 3] >> (cell & 7)) & 1;
  return { columns, rows, wet, area, cellW: area.w / table.width * table.cellPixels, cellH: area.h / table.height * table.cellPixels };
}

function newCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * The village river, moving: two layers of glints drifting across the open
 * water at different speeds, fading in and out, and foam along the shore that
 * breathes. The water itself is in the baked ground; this only lays light on
 * it, through masks baked with it (bake-forest-village-scene.mjs), so it
 * never spills onto a bank or a bridge. Only the part of the screen with water
 * in it is worked on: none at all when no water is in view. This is the canvas's
 * river, for when the WebGL world cannot draw it (soul-water-gl.ts).
 */
export function createSoulWater(options: {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  water: () => HTMLImageElement | undefined;
  shore: () => HTMLImageElement | undefined;
  viewport: () => { width: number; height: number };
  time: () => number;
  /** Off (Low Performance Mode), the river is the baked ground's, still. */
  active?: () => boolean;
}) {
  let layer: HTMLCanvasElement | null = null;
  let target: CanvasRenderingContext2D | null = null;
  let patterns: CanvasPattern[] | null = null;
  let cells: WaterCells | null = null;
  /** The open water's mask and the shore's foam for the layer's stretch, a pixel per world unit, cut once per stretch. */
  let mask: HTMLCanvasElement | null = null, foam: HTMLCanvasElement | null = null;
  let maskKey = "", foamKey = "";
  const matrix = typeof DOMMatrix === "undefined" ? null : new DOMMatrix();
  /** Which stretch of water the layer was last lit for, and when. */
  let litKey = "", litAt = Number.NaN;

  /** Cuts a sheet's part for the layer's stretch at a pixel per world unit, the east bridge's deck left out. */
  function cut(into: HTMLCanvasElement, sheet: HTMLImageElement, left: number, top: number, width: number, height: number) {
    const context = into.getContext("2d");
    if (!context) return false;
    const area = SOUL_VILLAGE_GROUND, scaleX = sheet.naturalWidth / area.w, scaleY = sheet.naturalHeight / area.h;
    context.clearRect(0, 0, into.width, into.height);
    context.imageSmoothingEnabled = true;
    context.drawImage(decodedImage(sheet), (left - area.x) * scaleX, (top - area.y) * scaleY, width * scaleX, height * scaleY, 0, 0, width, height);
    // The east bridge's deck was laid after the masks were baked: neither light nor foam shows on it.
    const deck = EAST_BRIDGE_DECK;
    context.clearRect(deck.left - left, deck.top - top, deck.right - deck.left, deck.bottom - deck.top);
    return true;
  }

  return function drawSoulWater() {
    if (options.active && !options.active()) return;
    const water = options.water(), shore = options.shore();
    if (!water?.complete || water.naturalWidth <= 0) return;
    const { ctx, camera } = options;
    const view = options.viewport();
    const area = SOUL_VILLAGE_GROUND;
    const inView = {
      left: Math.max(area.x, camera.x), top: Math.max(area.y, camera.y),
      right: Math.min(area.x + area.w, camera.x + view.width / camera.zoom), bottom: Math.min(area.y + area.h, camera.y + view.height / camera.zoom),
    };
    if (inView.left >= inView.right || inView.top >= inView.bottom) return;
    cells ??= waterCellsFromBits(SOUL_WATER_CELLS, SOUL_VILLAGE_GROUND);
    // The layer covers the water near the view on a coarse grid, so it holds still while the camera drifts and
    // only needs relighting when the glints have moved: a few times a second is smooth for light this slow.
    const reach = {
      left: Math.max(area.x, Math.floor(inView.left / LAYER_GRID) * LAYER_GRID), top: Math.max(area.y, Math.floor(inView.top / LAYER_GRID) * LAYER_GRID),
      right: Math.min(area.x + area.w, Math.ceil(inView.right / LAYER_GRID) * LAYER_GRID), bottom: Math.min(area.y + area.h, Math.ceil(inView.bottom / LAYER_GRID) * LAYER_GRID),
    };
    const wet = waterRectInView(cells, reach);
    if (!wet) return;
    let spans: ReturnType<typeof waterRowsInView> | null = waterRowsInView(cells, reach);
    // Clipping costs a little itself: worth it only where the spans leave much of the box dry.
    if (spans && spans.reduce((sum, span) => sum + (span.right - span.left) * (span.bottom - span.top), 0) > .6 * (wet.right - wet.left) * (wet.bottom - wet.top)) spans = null;
    const clipTo = (target: CanvasRenderingContext2D, ox: number, oy: number) => {
      if (!spans) return;
      target.beginPath();
      // A couple of units past each span: the light is scaled up smoothly, and its edge blends into the next pixel.
      for (const span of spans) target.rect(span.left - ox - 2, span.top - oy - 2, span.right - span.left + 4, span.bottom - span.top + 4);
      target.clip();
    };
    // Whole world units, so the layer's pixels line up with the world's.
    const left = Math.floor(wet.left), top = Math.floor(wet.top), right = Math.ceil(wet.right), bottom = Math.ceil(wet.bottom);
    const width = right - left, height = bottom - top;
    // What of it is on screen.
    const showLeft = Math.max(left, inView.left), showTop = Math.max(top, inView.top);
    const showRight = Math.min(right, inView.right), showBottom = Math.min(bottom, inView.bottom);
    if (showLeft >= showRight || showTop >= showBottom) return;
    const t = options.time();
    const key = `${left},${top},${right},${bottom}`;
    if (key !== litKey || !(t >= litAt && t - litAt < RELIGHT_SECONDS)) {
      // The light is worked on in a layer just big enough for the water near the view, a pixel per world unit
      // (the glints' and the mask's own detail), and only then laid over the world: a screen-sized layer cost a
      // full-screen clear, two fills, a mask and a copy of the whole layer every frame, water in view or not.
      const fitWidth = Math.ceil(width / LAYER_STEP) * LAYER_STEP, fitHeight = Math.ceil(height / LAYER_STEP) * LAYER_STEP;
      // Grown when the water near the view outgrows it, shrunk when it is far bigger than it needs to be. A new layer
      // each time, never a resized one: Firefox's GPU canvas copied one made smaller hundreds of times slower, for good.
      if (!layer || layer.width < width || layer.height < height || layer.width * layer.height > 4 * fitWidth * fitHeight) {
        layer = newCanvas(fitWidth, fitHeight);
        mask = newCanvas(fitWidth, fitHeight);
        foam = newCanvas(fitWidth, fitHeight);
        target = null; patterns = null; maskKey = foamKey = "";
      }
      // Cut again only when the stretch moves: a scaled copy of a big sheet each relight was most of the cost.
      if (maskKey !== key) maskKey = cut(mask!, water, left, top, width, height) ? key : "";
      if (foamKey !== key && shore?.complete && shore.naturalWidth > 0) foamKey = cut(foam!, shore, left, top, width, height) ? key : "";
      target ??= layer.getContext("2d");
      if (!target) return;
      const glints = target;
      patterns ??= [glintTile(7), glintTile(29)].map(tile => glints.createPattern(tile, "repeat")).filter((pattern): pattern is CanvasPattern => Boolean(pattern));
      glints.setTransform(1, 0, 0, 1, 0, 0);
      glints.globalCompositeOperation = "source-over";
      glints.globalAlpha = 1;
      glints.clearRect(0, 0, width, height);
      glints.save();
      clipTo(glints, left, top);
      // Glints are pinned to the world, then slide with time, so the water moves rather than the camera. Whole units,
      // so the tiles are copied, not resampled.
      for (const [index, pattern] of patterns.entries()) {
        if (matrix) { matrix.e = Math.round(t * GLINT_DRIFT[index][0]) - left; matrix.f = Math.round(t * GLINT_DRIFT[index][1]) - top; pattern.setTransform(matrix); }
        // The layer is laid at full strength, so the glints carry their own.
        glints.globalAlpha = GLINT_STRENGTH * glintStrength(t, index);
        glints.fillStyle = pattern;
        glints.fillRect(0, 0, width, height);
      }
      // Keep only the open water, away from its shore.
      glints.globalAlpha = 1;
      glints.globalCompositeOperation = "destination-in";
      if (maskKey === key) glints.drawImage(mask!, 0, 0, width, height, 0, 0, width, height);
      else glints.clearRect(0, 0, width, height);
      // Foam along the shore, breathing, over the light: one layer to lay each frame.
      glints.globalCompositeOperation = "source-over";
      if (foamKey === key) {
        glints.globalAlpha = foamStrength(t);
        glints.drawImage(foam!, 0, 0, width, height, 0, 0, width, height);
      }
      glints.restore();
      litKey = key;
      litAt = t;
    }
    if (!layer) return;
    const showWidth = showRight - showLeft, showHeight = showBottom - showTop;
    ctx.save();
    clipTo(ctx, camera.x, camera.y);
    ctx.globalAlpha = 1;
    // Smoothly scaled up to the screen, as the glints and the masks always were.
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(layer, showLeft - left, showTop - top, showWidth, showHeight, showLeft - camera.x, showTop - camera.y, showWidth, showHeight);
    ctx.imageSmoothingEnabled = smoothing;
    ctx.restore();
  };
}

/** Where the east bridge's deck covers the river, as drawn (its two halves' solid part). */
export const EAST_BRIDGE_DECK = Object.freeze({
  left: TOWN_EAST_BRIDGE.x - 137, right: TOWN_EAST_BRIDGE.x + 136, top: TOWN_EAST_BRIDGE.y - 58, bottom: TOWN_EAST_BRIDGE.y + 70,
});
