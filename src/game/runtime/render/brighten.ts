/**
 * Draws, then draws again added on top at `extra` alpha: brightness(1 + extra)
 * for opaque art, without ctx.filter, which Firefox draws on the CPU.
 */
export function drawBrightened(ctx: CanvasRenderingContext2D, extra: number, draw: () => void) {
  draw();
  if (!(extra > 0)) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha *= Math.min(1, extra);
  draw();
  ctx.restore();
}
