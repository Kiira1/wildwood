import { describe, expect, it } from "vitest";
import { staticTilesToPreload } from "./world-renderer";

// What the world looks like (snapping, tiles, the minimap) is checked by the world scene (tools/visual-check).
describe("building a main-thread map's tiles ahead of the camera", () => {
  const ring = { startX: 0, startY: 0, endX: 2, endY: 2 };
  it("builds no more than its budget a frame, skipping tiles already built", () => {
    const built = new Set(["0:0", "1:0"]);
    expect(staticTilesToPreload(ring, (x, y) => built.has(`${x}:${y}`), 2, 40, 2)).toEqual([{ tileX: 2, tileY: 0 }, { tileX: 0, tileY: 1 }]);
  });

  it("never builds ahead into a full cache, where it would push out a tile in view", () => {
    expect(staticTilesToPreload(ring, () => false, 12, 12, 1)).toEqual([]);
    expect(staticTilesToPreload(ring, () => false, 11, 12, 3)).toEqual([{ tileX: 0, tileY: 0 }]);
  });

  it("stops once every tile in the ring is built", () => {
    expect(staticTilesToPreload(ring, () => true, 9, 40, 1)).toEqual([]);
  });
});
