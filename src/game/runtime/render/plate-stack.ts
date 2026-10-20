/** A line's ink: how far it reaches above and below its baseline. */
export type LineInk = { above: number; below: number };

/** Glyph ink plus the outline, half of which is drawn outside the glyph. */
export function textInk(metrics: { ascent: number; descent: number }, stroke: number): LineInk {
  return { above: metrics.ascent + stroke / 2, below: metrics.descent + stroke / 2 };
}

/** An icon drawn from `top` to `bottom`, relative to the baseline (up is negative). */
export function iconInk(top: number, bottom: number): LineInk {
  return { above: -top, below: bottom };
}

/** A line's text and icons together. */
export function unionInk(first: LineInk, ...rest: LineInk[]): LineInk {
  let above = first.above, below = first.below;
  for (const ink of rest) {
    above = Math.max(above, ink.above);
    below = Math.max(below, ink.below);
  }
  return { above, below };
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
