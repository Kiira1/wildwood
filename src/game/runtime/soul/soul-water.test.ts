import { describe, expect, it } from "vitest";
import { waterCellsFromAlpha, waterRectInView, waterRowsInView } from "./soul-water";

/** An RGBA mask, `width` × `height`, opaque where `wet` says. */
function mask(width: number, height: number, wet: (x: number, y: number) => boolean) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (wet(x, y)) data[(y * width + x) * 4 + 3] = 200;
  return data;
}

describe("where the village's water is", () => {
  // A 64 × 32 pixel mask over a 128 × 64 unit area at (1000, 2000): two units a pixel, cells of 8 pixels (16 units).
  const area = { x: 1_000, y: 2_000, w: 128, h: 64 };
  // A river down the mask's right quarter, and nothing else.
  const cells = waterCellsFromAlpha(mask(64, 32, x => x >= 48), 64, 32, area, 8);

  it("marks only the cells with water in them", () => {
    expect(cells.columns).toBe(8);
    expect(cells.rows).toBe(4);
    expect([...cells.wet.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it("finds none in a view of dry ground, so the water costs nothing there", () => {
    expect(waterRectInView(cells, { left: 1_000, top: 2_000, right: 1_090, bottom: 2_064 })).toBeNull();
  });

  it("works on only the water in view: its cells, clipped to the view", () => {
    expect(waterRectInView(cells, { left: 1_000, top: 2_010, right: 1_120, bottom: 2_040 })).toEqual({ left: 1_096, top: 2_010, right: 1_120, bottom: 2_040 });
    expect(waterRectInView(cells, { left: 900, top: 1_900, right: 1_300, bottom: 2_200 })).toEqual({ left: 1_096, top: 2_000, right: 1_128, bottom: 2_064 });
  });

  it("finds none when the view is off the village's ground altogether", () => {
    expect(waterRectInView(cells, { left: 5_000, top: 5_000, right: 6_000, bottom: 6_000 })).toBeNull();
  });

  it("lights only each row's own stretch of water, not the box round all of it", () => {
    // A river bending from the left quarter of the top row to the right quarter of the rows below.
    const bend = waterCellsFromAlpha(mask(64, 32, (x, y) => y < 8 ? x < 16 : x >= 48), 64, 32, area, 8);
    expect(waterRowsInView(bend, { left: 1_000, top: 2_000, right: 1_128, bottom: 2_064 })).toEqual([
      { left: 1_000, top: 2_000, right: 1_032, bottom: 2_016 },
      { left: 1_096, top: 2_016, right: 1_128, bottom: 2_064 },
    ]);
  });

  it("keeps the cells on the mask's pixels when its last cells run past its edge", () => {
    // 60 pixels in cells of 8: eight columns, the last only half on the mask. Cells stay 16 units wide.
    const edge = waterCellsFromAlpha(mask(60, 32, x => x >= 56), 60, 32, { x: 0, y: 0, w: 120, h: 64 }, 8);
    expect(edge.cellW).toBe(16);
    expect(waterRectInView(edge, { left: 0, top: 0, right: 120, bottom: 64 })).toEqual({ left: 112, top: 0, right: 120, bottom: 64 });
  });
});
