import type { AtlasImage, CanvasAtlas } from "../render/canvas-atlas";
import { platePixels, plateSize } from "../render/nameplate-scale";

/**
 * The part of an enemy's status that every enemy with the same bar shares:
 * the empty health bar and, at full health, the full bar. Positions are
 * relative to the bar's top edge, centred on x.
 */
export type EnemyStatusPlate = AtlasImage & { left: number; top: number; width: number; height: number };

/** An enemy's health bar: a long, thin pill with no numbers on it, at plate scale. */
export const ENEMY_HEALTH_BAR_HEIGHT = platePixels(5);
/** Pixels between the top of the bar and the bottom of the name's em box. */
export const ENEMY_NAME_GAP = plateSize(4);
export const ENEMY_HEALTH_FILL = "#55d568";
const PLATE_CACHE_LIMIT = 512;
const OUTLINE = 1;

type PillContext = Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "arcTo" | "closePath" | "fill">;
/** A rounded bar, its ends as round as its height allows; a sliver narrower than that stays a sliver. */
export function fillPill(ctx: PillContext, x: number, y: number, width: number, height: number) {
  if (!(width > 0) || !(height > 0)) return;
  const radius = Math.min(height / 2, width / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fill();
}

/**
 * A mob group is the same enemy many times over, and at full health each
 * one's bar is identical, so it is drawn once to a plate and every enemy's
 * bar is one image. A wounded enemy still uses the plate for its empty bar,
 * and draws only its green fill on top. The name is text over it, drawn from
 * a text sprite one to one on the screen's pixels (canvas.ts).
 *
 * Plates are drawn at the device pixel ratio so they land one-to-one on the
 * screen, and the cache is dropped whole when it fills, which only a very long
 * session across many maps can do.
 */
export function createEnemyStatusPlates(options: {
  pixelRatio: () => number;
  createCanvas?: () => HTMLCanvasElement;
  /** Plates packed onto shared pages (canvas-atlas.ts); without one, or with it full, each plate gets its own canvas. */
  atlas?: CanvasAtlas;
}) {
  const plates = new Map<string, EnemyStatusPlate>();
  const createCanvas = options.createCanvas ?? (() => document.createElement("canvas"));
  // The atlas starting over drops every plate on it.
  options.atlas?.onReset(() => plates.clear());

  function build(barW: number, barH: number, full: boolean, scale: number): EnemyStatusPlate {
    const barLeft = -barW / 2;
    const left = Math.floor(barLeft - OUTLINE) - 1;
    const right = Math.ceil(barLeft + barW + OUTLINE) + 1;
    const top = -OUTLINE - 1;
    const bottom = Math.ceil(barH + OUTLINE) + 1;
    const width = right - left;
    const height = bottom - top;
    const pixelWidth = Math.ceil(width * scale), pixelHeight = Math.ceil(height * scale);
    const paint = (plateCtx: CanvasRenderingContext2D) => {
      plateCtx.transform(scale, 0, 0, scale, -left * scale, -top * scale);
      plateCtx.fillStyle = "rgba(0,0,0,.8)";
      fillPill(plateCtx, barLeft - OUTLINE, -OUTLINE, barW + OUTLINE * 2, barH + OUTLINE * 2);
      plateCtx.fillStyle = "#000";
      fillPill(plateCtx, barLeft, 0, barW, barH);
      if (full) {
        plateCtx.fillStyle = ENEMY_HEALTH_FILL;
        fillPill(plateCtx, barLeft, 0, barW, barH);
      }
    };
    const region = options.atlas?.allocate(pixelWidth, pixelHeight);
    if (region && options.atlas!.drawInto(region, paint)) {
      return { canvas: region.canvas, sx: region.x, sy: region.y, sw: pixelWidth, sh: pixelHeight, left, top, width, height };
    }
    const canvas = createCanvas();
    const plateCtx = canvas.getContext("2d");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    if (plateCtx) paint(plateCtx);
    return { canvas, left, top, width, height };
  }

  /** `full`: the enemy is at full health, so the plate carries the full bar too. */
  function plate(barW: number, barH: number, full: boolean) {
    const scale = options.pixelRatio();
    const key = `${scale}|${barW}|${barH}|${full ? 1 : 0}`;
    const cached = plates.get(key);
    if (cached) return cached;
    if (plates.size >= PLATE_CACHE_LIMIT) plates.clear();
    const built = build(barW, barH, full, scale);
    plates.set(key, built);
    return built;
  }

  return { plate, size: () => plates.size };
}
