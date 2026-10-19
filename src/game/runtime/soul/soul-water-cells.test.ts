import { describe, expect, it } from "vitest";
import { SOUL_VILLAGE_GROUND } from "../../soul-village";
import { SOUL_WATER_CELLS } from "./soul-water-cells";
import { waterCellsFromAlpha, waterCellsFromBits } from "./soul-water";

describe("the baked table of the village's water", () => {
  it("matches the water and shore masks it was baked from (re-run bake-water-cells.mjs after changing them)", async () => {
    const sharp = (await import("sharp")).default;
    const read = (name: string) => sharp(new URL(`../../../../public/assets/wildstat/soul-dimension/${name}`, import.meta.url).pathname)
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const [water, shore] = await Promise.all([read("village-water.webp"), read("village-shore.webp")]);
    const { width, height } = water.info;
    const alpha = new Uint8ClampedArray(width * height * 4);
    for (let index = 3; index < alpha.length; index += 4) alpha[index] = Math.max(water.data[index], shore.data[index]);
    const measured = waterCellsFromAlpha(alpha, width, height, SOUL_VILLAGE_GROUND, SOUL_WATER_CELLS.cellPixels);
    const baked = waterCellsFromBits(SOUL_WATER_CELLS, SOUL_VILLAGE_GROUND);
    expect([baked.columns, baked.rows, baked.cellW, baked.cellH]).toEqual([measured.columns, measured.rows, measured.cellW, measured.cellH]);
    expect([...baked.wet]).toEqual([...measured.wet]);
  });
});
