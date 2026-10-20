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
