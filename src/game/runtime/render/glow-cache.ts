import { deviceScale } from "./shrunk-image";

type Canvas = { width: number; height: number; getContext(kind: "2d"): CanvasRenderingContext2D | null };
type Bake = { key: string; canvas: Canvas; pad: number; scale: number };

/** Scale steps a bake is kept across, so an easing camera zoom does not re-bake every frame. */
const SCALE_STEP = .25;

/**
 * A sprite's blurred, coloured halo, baked once per sprite, size and zoom step.
 * Drawn under the sprite in place of a per-frame shadowBlur, which sends
 * Firefox's accelerated canvas back to drawing on the CPU every frame.
 * Like shadowBlur, `blur` is in device pixels.
 */
export function createGlowCache(createCanvas: () => Canvas = () => document.createElement("canvas")) {
  const bakes = new WeakMap<object, Bake>();

  function bake(source: CanvasImageSource, width: number, height: number, scale: number, color: string, blur: number, key: string): Bake | null {
    const pad = Math.ceil(blur * 1.5) + 2;
    const canvas = createCanvas();
    canvas.width = Math.max(1, Math.ceil(width * scale)) + pad * 2;
    canvas.height = Math.max(1, Math.ceil(height * scale)) + pad * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // The sprite is drawn off the canvas and only its shadow is shifted in.
    const away = canvas.width + 64;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = away;
    ctx.drawImage(source, pad - away, pad, width * scale, height * scale);
    return { key, canvas, pad, scale };
  }

  /** Draws the halo for a sprite drawn at (x, y, width, height); returns false when nothing was drawn. */
  return function drawGlow(ctx: CanvasRenderingContext2D, owner: object, source: CanvasImageSource, x: number, y: number, width: number, height: number, color: string, blur: number) {
    const exact = deviceScale(ctx);
    if (!(exact > 0) || width <= 0 || height <= 0) return false;
    const scale = Math.max(SCALE_STEP, Math.round(exact / SCALE_STEP) * SCALE_STEP);
    const key = `${width}x${height}@${scale}:${color}:${blur}`;
    let found = bakes.get(owner);
    if (!found || found.key !== key) {
      const made = bake(source, width, height, scale, color, blur, key);
      if (!made) return false;
      bakes.set(owner, found = made);
    }
    const pad = found.pad / found.scale;
    ctx.drawImage(found.canvas as CanvasImageSource, x - pad, y - pad, found.canvas.width / found.scale, found.canvas.height / found.scale);
    return true;
  };
}
