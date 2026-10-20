import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { removeGreenPixels } from "../render/sprite-pixels";
import { BOSS_ART } from "./boss-art";
import { bossFrameCrop, bossSheetFrameGeometry } from "./boss-frame-crop";
import { bossSheetFrameGeometry as geometryWithCrop } from "./boss-frame-geometry";
import { BOSSES, type BossArtSource } from "./boss-registry";
import { CARAPACE_ANGLER_ATLAS } from "./carapace-angler-sprite";
import { DREADREAPER_ATLAS } from "./dreadreaper-sprite";
import { IRONHORN_ATLAS } from "./ironhorn-sprite";

/** Alpha above this is art a player can see. */
const VISIBLE = 8;
/** No visible pixel may sit this close to its frame's edge, or it was cut there. */
const EDGE = 2;

type Pixels = { data: Buffer; width: number; height: number };
async function decode(src: string): Promise<Pixels> {
  const { data, info } = await sharp(readFileSync(new URL(`../../../../public/${src}`, import.meta.url)))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** The box of visible pixels inside a rectangle, and how many touch its edge. */
function visibleIn(pixels: Pixels, rect: { x: number; y: number; w: number; h: number }) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, onEdge = 0;
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      if (pixels.data[(y * pixels.width + x) * 4 + 3] <= VISIBLE) continue;
      left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
      if (x - rect.x < EDGE || y - rect.y < EDGE || rect.x + rect.w - x <= EDGE || rect.y + rect.h - y <= EDGE) onEdge += 1;
    }
  }
  return { left, top, right, bottom, onEdge };
}

// Every boss sheet the game draws, with the green key it applies at load.
const drawnSheets = Object.values(BOSS_ART).flatMap((entry) => {
  if (!("sheet" in entry) || !entry.sheet) return [];
  const src = `assets/wildstat/${entry.sheet}`;
  const art = Object.values(BOSSES).map((boss): BossArtSource => boss.art)
    .find((source) => ("sheet" in source ? source.sheet === src : source.pages.includes(src)));
  if (!art) return [];
  const chroma = "sheet" in art ? art.chroma : undefined;
  return [{ entry, src, chroma }];
});

describe("boss sheet frames", () => {
  it("covers every sheet boss the registry draws", () => {
    expect(drawnSheets.map(({ entry }) => entry.id).sort()).toEqual([
      "AEGIS_PRIME", "DRAGON", "FROSTCLAW", "GLOOMROOT", "GRAVEBLOOM", "KOI_SHOGUN",
      "MAGMALISK", "MIREMAW", "PRISMSHELL", "SPIDER", "TEMPEST_KIRIN", "VOLTWARDEN",
    ]);
  });

  for (const { entry, src, chroma } of drawnSheets) {
    it(`${entry.name} has room around every pose, and draws all of it`, async () => {
      const pixels = await decode(src);
      if (chroma) removeGreenPixels(pixels.data as unknown as Uint8ClampedArray, chroma.greenThreshold, chroma.ratio);
      const columns = entry.frames ?? 1, rows = "rows" in entry ? entry.rows ?? 1 : 1;
      const cellWidth = pixels.width / columns, cellHeight = pixels.height / rows;
      expect(Number.isInteger(cellWidth) && Number.isInteger(cellHeight)).toBe(true);
      if (entry.drawHeight) {
        // Padding grows the box with the cell; it never stretches the pose.
        expect(entry.drawWidth / cellWidth / (entry.drawHeight / cellHeight)).toBeCloseTo(1, 2);
      }
      for (let frame = 0; frame < columns * rows; frame += 1) {
        const cell = { x: (frame % columns) * cellWidth, y: Math.floor(frame / columns) * cellHeight, w: cellWidth, h: cellHeight };
        const art = visibleIn(pixels, cell);
        expect({ frame, onEdge: art.onEdge }).toEqual({ frame, onEdge: 0 });
        // The tuner's frame crop must leave the whole pose inside the drawn window.
        const window = bossSheetFrameGeometry({ bossId: entry.id, frame, cellWidth, cellHeight, columns, drawWidth: 100, drawHeight: 100 });
        expect(window).not.toBeNull();
        expect(window!.sourceX).toBeLessThanOrEqual(art.left);
        expect(window!.sourceY).toBeLessThanOrEqual(art.top);
        expect(window!.sourceX + window!.sourceWidth).toBeGreaterThanOrEqual(art.right);
        expect(window!.sourceY + window!.sourceHeight).toBeGreaterThanOrEqual(art.bottom);
      }
    });
  }

  for (const [id, atlas] of [["CARAPACE_ANGLER", CARAPACE_ANGLER_ATLAS], ["IRONHORN", IRONHORN_ATLAS], ["DREADREAPER", DREADREAPER_ATLAS]] as const) {
    it(`${id} atlas frames have room around every pose, and draw all of it`, async () => {
      const pages = new Map<number, Pixels>();
      const frames = [...atlas.animations.idle.frames, ...atlas.animations.attack.frames];
      for (const [index, frame] of frames.entries()) {
        if (!pages.has(frame.page)) pages.set(frame.page, await decode(atlas.pages[frame.page].src));
        const art = visibleIn(pages.get(frame.page)!, frame);
        expect({ index, onEdge: art.onEdge }).toEqual({ index, onEdge: 0 });
        // The window drawBossAtlasFrame draws: the content bounds, less any frame crop.
        const crop = bossFrameCrop(id, index), bounds = frame.contentBounds ?? { x: 0, y: 0, w: frame.w, h: frame.h };
        const window = geometryWithCrop({ bossId: id, frame: 0, sourceX: frame.x, sourceY: frame.y,
          cellWidth: frame.w, cellHeight: frame.h, drawWidth: 100, drawHeight: 100 },
        { ...crop, clipLeft: Math.max(bounds.x, crop.clipLeft ?? 0), clipTop: Math.max(bounds.y, crop.clipTop ?? 0),
          clipRight: Math.max(frame.w - bounds.x - bounds.w, crop.clipRight ?? 0), clipBottom: Math.max(frame.h - bounds.y - bounds.h, crop.clipBottom ?? 0) });
        expect(window).not.toBeNull();
        const left = window!.sourceX, top = window!.sourceY, right = left + window!.sourceWidth, bottom = top + window!.sourceHeight;
        expect(left).toBeLessThanOrEqual(art.left);
        expect(top).toBeLessThanOrEqual(art.top);
        expect(right).toBeGreaterThanOrEqual(art.right);
        expect(bottom).toBeGreaterThanOrEqual(art.bottom);
      }
    });
  }
});
