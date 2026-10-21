/** A line's ink: how far it reaches above and below its baseline. */
export type LineInk = { above: number; below: number };

/** Glyph ink plus the outline, half of which is drawn outside the glyph. */
export function textInk(metrics: { ascent: number; descent: number }, stroke: number): LineInk {
  return { above: metrics.ascent + stroke / 2, below: metrics.descent + stroke / 2 };
}

/**
 * Stacks lines upwards from `floor`, `gap` between one line's ink and the next,
 * so the spaces look even whatever each line holds. Baselines come back
 * bottom line first; `top` is the top of the highest ink.
 */
export function stackPlateLines(lines: readonly LineInk[], floor: number, gap: number) {
  const baselines: number[] = [];
  let edge = floor;
  for (const line of lines) {
    const baseline = edge - gap - line.below;
    baselines.push(baseline);
    edge = baseline - line.above;
  }
  return { baselines, top: edge };
}

/** Where an icon's artwork starts and ends down its box, 0 to 1. */
export type IconArt = { inkTop: number; inkBottom: number };

/** An icon's box on a line of text, its ink `inkHeight` tall and centred on the capitals. Relative to the baseline. */
export function plateIconBox(capHeight: number, inkHeight: number, art: IconArt) {
  const size = inkHeight / (art.inkBottom - art.inkTop);
  const top = -capHeight / 2 - size * (art.inkTop + art.inkBottom) / 2;
  return { top, size, inkTop: top + size * art.inkTop, inkBottom: top + size * art.inkBottom };
}
