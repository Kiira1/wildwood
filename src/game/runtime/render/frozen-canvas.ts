/**
 * Finished cache canvases copied once into ImageBitmaps. Firefox kept many cache canvases on the GPU while the
 * game canvas drew on the CPU, and copied each one back on every single draw; a bitmap is copied once.
 * Where createImageBitmap is missing, everything keeps drawing the canvas.
 */
export type FrozenImage = HTMLCanvasElement | ImageBitmap;

function isBitmap(image: unknown): image is ImageBitmap {
  return typeof (image as ImageBitmap | null)?.close === "function";
}

/**
 * Copies a canvas that will not change again into a bitmap. `install` puts the bitmap where the canvas was and
 * returns false when the cache let the canvas go meanwhile; the bitmap is then closed.
 */
export function freezeCanvas(canvas: HTMLCanvasElement, install: (bitmap: ImageBitmap) => boolean) {
  if (typeof createImageBitmap !== "function" || !(canvas.width > 0) || !(canvas.height > 0)) return;
  createImageBitmap(canvas).then(bitmap => { if (!install(bitmap)) bitmap.close(); }, () => {});
}

type Entries<K> = { get(key: K): FrozenImage | undefined; set(key: K, value: FrozenImage): unknown };

/** freezeCanvas for a cache entry: the bitmap takes the canvas's place while the key still holds that canvas. */
export function freezeEntry<K>(cache: Entries<K>, key: K, canvas: HTMLCanvasElement) {
  freezeCanvas(canvas, bitmap => {
    if (cache.get(key) !== canvas) return false;
    cache.set(key, bitmap);
    return true;
  });
}

/** Gives an evicted entry back: a bitmap is closed at once, a canvas is left to the collector. */
export function releaseFrozen(image: unknown) {
  if (isBitmap(image)) image.close();
}

/** Bitmaps of canvases that stay in use as canvases too (shared pages, sources the WebGL layer keys on). */
const copies = new WeakMap<object, ImageBitmap>();
const versions = new WeakMap<object, number>();

/** What to draw for a canvas: its frozen copy once there is one, the canvas until then. */
export function frozenCopyOf<T extends CanvasImageSource>(canvas: T): T | ImageBitmap {
  return copies.get(canvas) ?? canvas;
}

/** Makes a bitmap copy of a canvas that is kept as it is; thawCopy() before drawing into the canvas again. */
export function freezeCopy(canvas: HTMLCanvasElement) {
  if (copies.has(canvas)) return;
  const version = versions.get(canvas) ?? 0;
  freezeCanvas(canvas, bitmap => {
    if ((versions.get(canvas) ?? 0) !== version || copies.has(canvas)) return false;
    copies.set(canvas, bitmap);
    return true;
  });
}

/** Drops a canvas's copy because the canvas is about to change; a copy still being made is dropped when it lands. */
export function thawCopy(canvas: HTMLCanvasElement) {
  versions.set(canvas, (versions.get(canvas) ?? 0) + 1);
  copies.get(canvas)?.close();
  copies.delete(canvas);
}
