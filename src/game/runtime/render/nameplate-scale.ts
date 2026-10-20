/** Overhead plates (name, power, health bar) over players and enemies, against their first size. */
export const NAMEPLATE_SCALE = 0.78;

const PLATE_FONT_FAMILY = '"Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif';

/** A plate length at plate scale. */
export function plateSize(px: number) {
  return px * NAMEPLATE_SCALE;
}

/** Whole pixels, for bar edges that should land on the pixel grid. */
export function platePixels(px: number) {
  return Math.round(px * NAMEPLATE_SCALE);
}

/** The plates' bold rounded font at plate scale; drawn at this size, so the text stays sharp. */
export function plateFont(px: number) {
  return `900 ${+plateSize(px).toFixed(2)}px ${PLATE_FONT_FAMILY}`;
}

/** Outlines under this would stop reading as an outline: a 2px stroke shows 1px outside the glyph. */
export const PLATE_MIN_STROKE = 2;

/**
 * A plate text outline: the scaled stroke, its visible outline one pixel
 * thinner (canvas strokes half outside the glyph, so 2 off the width), never
 * thinner than PLATE_MIN_STROKE; one already under that keeps its width.
 */
export function plateStroke(px: number) {
  const scaled = plateSize(px);
  return scaled <= PLATE_MIN_STROKE ? scaled : Math.max(PLATE_MIN_STROKE, scaled - 2);
}
