import { itemPresentation } from "../../item-presentation";
import { EXPANSION_HEAD_FRAME } from "../../player-head-template";
import { PLAYER_WORLD_SCALE } from "../../player-render-scale";
import { plateSize } from "./nameplate-scale";

/** drawStartingPlayer stands character row 171 on a point 29 below the actor's y. */
const FEET_ROW = 171;
const FEET_OFFSET_Y = 29;
/** The idle bob lifts the head up to 3 rows; the plate stays above the highest frame rather than bobbing. */
const HEAD_BOB_ROWS = 3;
/** Fainter than this is the art's soft edge, not part of the helmet. */
const INK_ALPHA = 24;

/** Label pixels between the top of the head or helmet and the bottom of the health bar's frame. */
export const OVERHEAD_PLATE_GAP = plateSize(3);
/** Label pixels from the top of the head or helmet to the bottom of a name and power shown without a bar. */
export const OVERHEAD_IDENTITY_LIFT = plateSize(17);

type HeadSprite = { naturalWidth: number; naturalHeight: number; complete?: boolean };
export type BlankRowsAbove = (sprite: HeadSprite) => number;

const measuredBlankRows = new WeakMap<object, number>();

/** Transparent rows above a sprite's ink, read once per image; 0 when it cannot be read, which errs high. */
export const spriteBlankRowsAbove: BlankRowsAbove = (sprite) => {
  const known = measuredBlankRows.get(sprite);
  if (known !== undefined) return known;
  if (!sprite.complete || sprite.naturalWidth <= 0 || sprite.naturalHeight <= 0) return 0;
  let rows = 0;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = sprite.naturalWidth;
    canvas.height = sprite.naturalHeight;
    const target = canvas.getContext("2d", { willReadFrequently: true });
    if (target) {
      target.drawImage(sprite as CanvasImageSource, 0, 0);
      const pixels = target.getImageData(0, 0, canvas.width, canvas.height).data;
      rows = blankRowsAbove(pixels, canvas.width, canvas.height);
    }
  } catch { rows = 0; }
  measuredBlankRows.set(sprite, rows);
  return rows;
};

export function blankRowsAbove(pixels: ArrayLike<number>, width: number, height: number) {
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (pixels[(row * width + column) * 4 + 3] > INK_ALPHA) return row;
    }
  }
  return height;
}

/** The highest character-space row the head or worn helmet reaches, idle bob included. */
export function headArtTopRow(headItem: string | undefined, sprite: HeadSprite | undefined, blankRows: BlankRowsAbove = spriteBlankRowsAbove) {
  let top: number = EXPANSION_HEAD_FRAME.y;
  const world = headItem ? itemPresentation(headItem)?.world : undefined;
  // The helmet is only drawn once its image has loaded.
  if (world?.kind === "SPRITE" && world.layer === "HEAD" && sprite && sprite.naturalHeight > 0) {
    const height = world.height ?? sprite.naturalHeight;
    const frameTop = world.top ?? (world.bottom ?? height) - height;
    top = Math.min(top, frameTop + blankRows(sprite) * height / sprite.naturalHeight);
  }
  return top - HEAD_BOB_ROWS;
}

/** World distance from the actor's y up to the top of its head or helmet (negative is up). */
export function headArtTopOffsetY(headItem: string | undefined, sprite: HeadSprite | undefined, blankRows?: BlankRowsAbove) {
  return FEET_OFFSET_Y + (headArtTopRow(headItem, sprite, blankRows) - FEET_ROW) * PLAYER_WORLD_SCALE;
}
