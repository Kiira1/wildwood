import { freezeCopy, frozenCopyOf, thawCopy } from "./frozen-canvas";

/**
 * A few large shared canvases ("pages") that many small pre-drawn images are packed onto, in place of
 * one canvas each. Hundreds of tiny canvases (every enemy's name label and name plate) can run past a
 * browser's limits on GPU canvases: in Firefox some come out blank, and a GPU
 * handles a few big images better than hundreds of small ones anyway.
 *
 * Images are packed in rows ("shelves"). Pages are made only when needed, up to a cap. When every page
 * is full, the next allocation fails (the caller then makes its own canvas) and the atlas
 * starts over at the next resetIfFull(): every page is cleared and every onReset listener drops what
 * it cached, so call resetIfFull() only where nothing from the atlas is held across the call. release()
 * does the same and also lets the pages go, so pages filled on earlier maps are not kept all session.
 * A page left unchanged for PAGE_SETTLE_MS is drawn from a frozen bitmap copy (frozen-canvas.ts) until it changes.
 */
export type AtlasImage = {
  canvas: HTMLCanvasElement;
  /** The image's rectangle on its canvas, in canvas pixels; absent for a canvas of its own. */
  sx?: number; sy?: number; sw?: number; sh?: number;
};
export type AtlasRegion = { canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number };

/** Space left between images, so smoothing never blends a neighbour's edge in. */
const GAP = 2;
/** Labels arrive in bursts as a map fills; a page is frozen once none has arrived for this long. */
export const PAGE_SETTLE_MS = 500;

type Page = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D | null; shelfTop: number; shelfHeight: number; cursorX: number;
  settle?: ReturnType<typeof setTimeout> };

export function createCanvasAtlas(options: { pageSize?: number; maxPages?: number; createCanvas?: () => HTMLCanvasElement } = {}) {
  const pageSize = options.pageSize ?? 1024;
  const maxPages = options.maxPages ?? 8;
  const createCanvas = options.createCanvas ?? (() => document.createElement("canvas"));
  const pages: Page[] = [];
  const resetListeners: (() => void)[] = [];
  let full = false;

  function place(page: Page, width: number, height: number) {
    if (page.cursorX + width > pageSize) {
      page.shelfTop += page.shelfHeight + GAP;
      page.shelfHeight = 0;
      page.cursorX = 0;
    }
    if (page.shelfTop + height > pageSize) return null;
    const at = { x: page.cursorX, y: page.shelfTop };
    page.cursorX += width + GAP;
    page.shelfHeight = Math.max(page.shelfHeight, height);
    return at;
  }

  /** Room for a width × height image (canvas pixels), or null: too big for a page, or the atlas is full. */
  function allocate(width: number, height: number): AtlasRegion | null {
    const w = Math.ceil(width), h = Math.ceil(height);
    if (!(w > 0) || !(h > 0) || w > pageSize || h > pageSize) return null;
    for (const page of pages) {
      const at = place(page, w, h);
      if (at) return { canvas: page.canvas, x: at.x, y: at.y, width: w, height: h };
    }
    if (pages.length < maxPages) {
      const canvas = createCanvas();
      canvas.width = pageSize;
      canvas.height = pageSize;
      const page: Page = { canvas, context: canvas.getContext("2d"), shelfTop: 0, shelfHeight: 0, cursorX: 0 };
      pages.push(page);
      const at = place(page, w, h);
      if (at) return { canvas, x: at.x, y: at.y, width: w, height: h };
    }
    full = true;
    return null;
  }

  /**
   * Draws into a region: `draw` gets the page's context translated to the region's corner and clipped
   * to it. Use transform(), not setTransform(), inside, so the translation holds.
   */
  function drawInto(region: AtlasRegion, draw: (ctx: CanvasRenderingContext2D) => void) {
    const page = pages.find(candidate => candidate.canvas === region.canvas);
    const ctx = page?.context;
    if (!page || !ctx) return false;
    thaw(page);
    ctx.save();
    ctx.beginPath();
    ctx.rect(region.x, region.y, region.width, region.height);
    ctx.clip();
    ctx.translate(region.x, region.y);
    draw(ctx);
    ctx.restore();
    page.settle = setTimeout(() => { page.settle = undefined; freezeCopy(page.canvas); }, PAGE_SETTLE_MS);
    return true;
  }

  /** The page is about to change: its frozen copy goes, and a pending freeze waits for it to settle again. */
  function thaw(page: Page) {
    thawCopy(page.canvas);
    if (page.settle !== undefined) clearTimeout(page.settle);
    page.settle = undefined;
  }

  /** Starts over if an allocation found the atlas full: pages cleared, listeners told to drop their caches. */
  function resetIfFull() {
    if (!full) return false;
    full = false;
    for (const page of pages) {
      thaw(page);
      page.context?.clearRect(0, 0, pageSize, pageSize);
      page.shelfTop = 0; page.shelfHeight = 0; page.cursorX = 0;
    }
    for (const listener of resetListeners) listener();
    return true;
  }

  /**
   * Gives every page back (a new map needs few of the last one's images): pages emptied and dropped, listeners
   * told to drop what they cached. Same rule as resetIfFull(): nothing from the atlas may be held across it.
   */
  function release() {
    full = false;
    for (const page of pages.splice(0)) {
      thaw(page);
      page.canvas.width = 0;
      page.canvas.height = 0;
    }
    for (const listener of resetListeners) listener();
  }

  return { allocate, drawInto, resetIfFull, release, onReset: (listener: () => void) => { resetListeners.push(listener); }, pageCount: () => pages.length };
}
export type CanvasAtlas = ReturnType<typeof createCanvasAtlas>;

/** Draws an atlas image (or a canvas of its own) at dx, dy, dw × dh. */
export function drawAtlasImage(ctx: Pick<CanvasRenderingContext2D, "drawImage">, image: AtlasImage, dx: number, dy: number, dw: number, dh: number) {
  // A released page is zero-sized, and drawing one would throw.
  if (!image.canvas.width || !image.canvas.height) return;
  const source = frozenCopyOf(image.canvas);
  if (image.sw === undefined || image.sh === undefined) ctx.drawImage(source, dx, dy, dw, dh);
  else ctx.drawImage(source, image.sx ?? 0, image.sy ?? 0, image.sw, image.sh, dx, dy, dw, dh);
}
