import { afterEach, expect, it, vi } from "vitest";
import { freezeCanvas, freezeCopy, freezeEntry, frozenCopyOf, releaseFrozen, thawCopy } from "./frozen-canvas";
import { createShrunkImages } from "./shrunk-image";
import { createCanvasAtlas, drawAtlasImage, PAGE_SETTLE_MS } from "./canvas-atlas";
import { residentImage } from "./resident-image";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type FakeBitmap = { width: number; height: number; closed: boolean; close(): void; from: unknown };

/** createImageBitmap that resolves when the test says so. */
function stubBitmaps() {
  const pending: { canvas: { width: number; height: number }; resolve: (bitmap: FakeBitmap) => void }[] = [];
  const made: FakeBitmap[] = [];
  vi.stubGlobal("createImageBitmap", (canvas: { width: number; height: number }) => new Promise<FakeBitmap>(resolve => pending.push({ canvas, resolve })));
  const settle = async () => {
    for (const { canvas, resolve } of pending.splice(0)) {
      const bitmap: FakeBitmap = { width: canvas.width, height: canvas.height, closed: false, from: canvas, close() { this.closed = true; this.width = this.height = 0; } };
      made.push(bitmap);
      resolve(bitmap);
    }
    await Promise.resolve(); await Promise.resolve();
  };
  return { pending, made, settle };
}

function fakeCanvas(width = 10, height = 10) {
  return { width, height, getContext: () => ({ drawImage() {}, clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, translate() {} }) } as unknown as HTMLCanvasElement;
}

function stubDocument() {
  vi.stubGlobal("document", { createElement: () => fakeCanvas(0, 0) });
}

it("puts the bitmap in the canvas's place once it is made, and closes it if the entry went meanwhile", async () => {
  const { made, settle } = stubBitmaps();
  const cache = new Map<string, HTMLCanvasElement | ImageBitmap>();
  const kept = fakeCanvas(), dropped = fakeCanvas();
  cache.set("kept", kept).set("dropped", dropped);
  freezeEntry(cache, "kept", kept);
  freezeEntry(cache, "dropped", dropped);
  expect(cache.get("kept")).toBe(kept);
  cache.delete("dropped");
  await settle();
  expect(cache.get("kept")).toBe(made[0]);
  expect(made[1].closed).toBe(true);
});

it("keeps drawing the canvas where createImageBitmap is missing", () => {
  vi.stubGlobal("createImageBitmap", undefined);
  const cache = new Map<string, HTMLCanvasElement | ImageBitmap>();
  const canvas = fakeCanvas();
  cache.set("a", canvas);
  freezeEntry(cache, "a", canvas);
  expect(cache.get("a")).toBe(canvas);
  expect(() => releaseFrozen(canvas)).not.toThrow();
});

it("leaves an empty canvas alone", () => {
  const { pending } = stubBitmaps();
  freezeCanvas(fakeCanvas(0, 0), () => true);
  expect(pending).toHaveLength(0);
});

it("shrunk images: canvas first, bitmap after, and evicted bitmaps are closed", async () => {
  const { made, settle } = stubBitmaps();
  stubDocument();
  vi.stubGlobal("HTMLImageElement", class {});
  const shrunk = createShrunkImages(150);
  const source = fakeCanvas(100, 100);
  const first = shrunk(source, 10, 10, true);
  expect(first).not.toBeNull();
  expect(typeof (first as unknown as FakeBitmap).close).toBe("undefined");
  await settle();
  const again = shrunk(source, 10, 10, true);
  expect(again).toBe(made[0]);
  // A second size over the budget pushes the first out, which closes its bitmap.
  shrunk(source, 12, 12, true);
  expect(made[0].closed).toBe(true);
});

it("atlas pages: drawn from the canvas while they change, from a bitmap once settled, thawed by a new image", async () => {
  vi.useFakeTimers();
  const { made, settle } = stubBitmaps();
  const atlas = createCanvasAtlas({ pageSize: 100, createCanvas: () => fakeCanvas(0, 0) });
  const region = atlas.allocate(10, 10)!;
  atlas.drawInto(region, () => {});
  const image = { canvas: region.canvas, sx: 0, sy: 0, sw: 10, sh: 10 };
  const drawn: unknown[] = [];
  const ctx = { drawImage: (source: unknown) => { drawn.push(source); } };
  drawAtlasImage(ctx, image, 0, 0, 10, 10);
  expect(drawn.pop()).toBe(region.canvas);
  vi.advanceTimersByTime(PAGE_SETTLE_MS);
  await settle();
  drawAtlasImage(ctx, image, 0, 0, 10, 10);
  expect(drawn.pop()).toBe(made[0]);
  atlas.drawInto(atlas.allocate(10, 10)!, () => {});
  expect(made[0].closed).toBe(true);
  drawAtlasImage(ctx, image, 0, 0, 10, 10);
  expect(drawn.pop()).toBe(region.canvas);
});

it("a copy still being made when its canvas changes is dropped", async () => {
  const { made, settle } = stubBitmaps();
  const canvas = fakeCanvas();
  freezeCopy(canvas);
  thawCopy(canvas);
  await settle();
  expect(made[0].closed).toBe(true);
  expect(frozenCopyOf(canvas)).toBe(canvas);
});

it("resident copies are frozen once made", async () => {
  const { made, settle } = stubBitmaps();
  stubDocument();
  const icon = residentImage({ complete: true, naturalWidth: 32, naturalHeight: 32 } as HTMLImageElement, 64);
  expect(icon()).toMatchObject({ width: 32, height: 32 });
  await settle();
  expect(icon()).toBe(made[0]);
});
