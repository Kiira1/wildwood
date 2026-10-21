import { expect, it, vi } from "vitest";
import { createCanvasAtlas, drawAtlasImage } from "./canvas-atlas";
import { createEnemyStatusPlates } from "../enemies/enemy-status-plate";

function fakeCanvas() {
  const calls: string[] = [];
  const context = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => { calls.push(`${key}(${args.map(arg => typeof arg === "object" ? "canvas" : String(arg)).join(",")})`); };
    },
    set(target, key: string, value) { target[key] = value; return true; },
  });
  return { canvas: { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement, calls };
}

it("packs images in rows on one page, making another only when the first is full", () => {
  const made: ReturnType<typeof fakeCanvas>[] = [];
  const atlas = createCanvasAtlas({ pageSize: 100, maxPages: 2, createCanvas: () => { const canvas = fakeCanvas(); made.push(canvas); return canvas.canvas; } });
  const a = atlas.allocate(40, 20)!, b = atlas.allocate(40, 20)!, c = atlas.allocate(40, 30)!;
  expect(made).toHaveLength(1);
  expect([a.x, a.y, b.x, b.y]).toEqual([0, 0, 42, 0]);
  // No room left in the row: the next row starts under the tallest image of this one.
  expect([c.x, c.y]).toEqual([0, 22]);
  expect(made[0].canvas.width).toBe(100);
  for (let i = 0; i < 4; i++) atlas.allocate(90, 30);
  expect(atlas.pageCount()).toBe(2);
});

it("turns away images too big for a page, and says full only after every page is", () => {
  const atlas = createCanvasAtlas({ pageSize: 100, maxPages: 1, createCanvas: () => fakeCanvas().canvas });
  expect(atlas.allocate(101, 10)).toBeNull();
  expect(atlas.resetIfFull()).toBe(false);
  expect(atlas.allocate(100, 100)).not.toBeNull();
  expect(atlas.allocate(10, 10)).toBeNull();
  const dropped = vi.fn();
  atlas.onReset(dropped);
  // Starting over clears the page and tells whoever cached a region to drop it.
  expect(atlas.resetIfFull()).toBe(true);
  expect(dropped).toHaveBeenCalledTimes(1);
  expect(atlas.allocate(10, 10)).toMatchObject({ x: 0, y: 0 });
  expect(atlas.resetIfFull()).toBe(false);
});

it("draws into a region clipped and translated to it, and draws an image from its rectangle", () => {
  const page = fakeCanvas();
  const atlas = createCanvasAtlas({ pageSize: 100, createCanvas: () => page.canvas });
  atlas.allocate(30, 10);
  const region = atlas.allocate(20, 10)!;
  atlas.drawInto(region, ctx => ctx.fillRect(0, 0, 5, 5));
  expect(page.calls).toEqual(["save()", "beginPath()", "rect(32,0,20,10)", "clip()", "translate(32,0)", "fillRect(0,0,5,5)", "restore()"]);
  const target = fakeCanvas();
  const ctx = target.canvas.getContext("2d")!;
  drawAtlasImage(ctx, { canvas: page.canvas, sx: 32, sy: 0, sw: 20, sh: 10 }, 1, 2, 3, 4);
  drawAtlasImage(ctx, { canvas: page.canvas }, 1, 2, 3, 4);
  expect(target.calls).toEqual(["drawImage(canvas,32,0,20,10,1,2,3,4)", "drawImage(canvas,1,2,3,4)"]);
});

it("puts every enemy bar's plate on the same shared page rather than a canvas each", () => {
  const made: ReturnType<typeof fakeCanvas>[] = [];
  const create = () => { const canvas = fakeCanvas(); made.push(canvas); return canvas.canvas; };
  const atlas = createCanvasAtlas({ createCanvas: create });
  const plates = createEnemyStatusPlates({ pixelRatio: () => 2, createCanvas: create, atlas });
  const first = plates.plate(80, 5, true);
  for (let width = 0; width < 40; width++) plates.plate(60 + width, 5, width % 2 === 0);
  expect(made).toHaveLength(1);
  expect(first.canvas).toBe(made[0].canvas);
  expect(first.sw).toBe(Math.ceil(first.width * 2));
});

it("lets every page go on release, and tells whoever cached a region to drop it", () => {
  const made: ReturnType<typeof fakeCanvas>[] = [];
  const atlas = createCanvasAtlas({ pageSize: 100, maxPages: 4, createCanvas: () => { const canvas = fakeCanvas(); made.push(canvas); return canvas.canvas; } });
  for (let i = 0; i < 3; i++) atlas.allocate(100, 100);
  expect(atlas.pageCount()).toBe(3);
  const dropped = vi.fn();
  atlas.onReset(dropped);
  atlas.release();
  expect(dropped).toHaveBeenCalledTimes(1);
  expect(atlas.pageCount()).toBe(0);
  expect(made.every(page => page.canvas.width === 0 && page.canvas.height === 0)).toBe(true);
  // A region still held by mistake draws nothing rather than throwing on a zero-sized canvas.
  const target = fakeCanvas();
  drawAtlasImage(target.canvas.getContext("2d")!, { canvas: made[0].canvas, sx: 0, sy: 0, sw: 10, sh: 10 }, 0, 0, 10, 10);
  expect(target.calls).toEqual([]);
  // The next image starts a fresh page.
  expect(atlas.allocate(10, 10)).toMatchObject({ x: 0, y: 0 });
  expect(atlas.pageCount()).toBe(1);
});
