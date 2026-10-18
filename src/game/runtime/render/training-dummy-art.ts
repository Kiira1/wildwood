import { drawScreenSpaceAt } from "./render-space";

const FONT = (size: number) => `900 ${size}px "Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif`;
/** How long a hit rocks it, in seconds. */
const WOBBLE_SECONDS = .35;
/** Its feet stand this far below its position (the middle of its body, where shots aim), in world units. */
const FEET_BELOW = 47;
/** Its head reaches this far above its position. */
const HEAD_ABOVE = 45;

/**
 * The Town's training dummy, drawn with canvas shapes (no art for it exists): a post with a crossbar, a burlap body
 * with a target on it and a sack for a head. It rocks when hit. Above it, its name, the DPS and the fight so far.
 * `x`, `y` are the middle of its body (the target), in the camera's world space; text is drawn at screen size.
 */
export function drawTrainingDummy(ctx: CanvasRenderingContext2D, options: {
  x: number; y: number; zoom: number; now: number;
  dummy: { readout: string; detail: string; hitAt: number };
  drawShadow: (x: number, y: number, width: number, alpha: number) => void;
  outlinedText: (text: string, x: number, y: number, color: string, strokeWidth?: number) => void;
}) {
  const { x, y, dummy } = options;
  options.drawShadow(x, y + FEET_BELOW + 2, 46, .36);
  const since = options.now - dummy.hitAt;
  const rock = since >= 0 && since < WOBBLE_SECONDS ? Math.sin(since * 34) * .09 * (1 - since / WOBBLE_SECONDS) : 0;
  ctx.save();
  ctx.translate(x, y + FEET_BELOW);
  ctx.rotate(rock);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Feet and post.
  ctx.fillStyle = "#4a2f1b";
  ctx.fillRect(-15, -6, 30, 6);
  ctx.fillStyle = "#6b4426";
  ctx.fillRect(-4, -80, 8, 76);
  // Crossbar arms, straw poking out of the ends.
  ctx.fillStyle = "#74492a";
  ctx.fillRect(-30, -62, 60, 7);
  ctx.strokeStyle = "#e9cd72";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const side of [-1, 1]) for (const lift of [-4, 0, 4]) { ctx.moveTo(side * 30, -58); ctx.lineTo(side * 37, -58 + lift); }
  ctx.stroke();
  // Burlap body.
  ctx.fillStyle = "#c8a266";
  ctx.strokeStyle = "#7a5a33";
  ctx.beginPath();
  ctx.ellipse(0, -44, 17, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#8b6a3b";
  ctx.fillRect(-16, -27, 32, 4);
  // The target.
  for (const [radius, color] of [[10, "#cf4536"], [6.5, "#f3e8d2"], [3, "#cf4536"]] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, -47, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  // Sack head, stitched face.
  ctx.fillStyle = "#d6b578";
  ctx.strokeStyle = "#7a5a33";
  ctx.beginPath();
  ctx.arc(0, -80, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#4a2f1b";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const eye of [-5, 5]) { ctx.moveTo(eye - 2.5, -84.5); ctx.lineTo(eye + 2.5, -79.5); ctx.moveTo(eye + 2.5, -84.5); ctx.lineTo(eye - 2.5, -79.5); }
  ctx.moveTo(-5, -74); ctx.lineTo(5, -74);
  ctx.stroke();
  ctx.restore();

  drawScreenSpaceAt(ctx, options.zoom, x, y, () => {
    const top = -(HEAD_ABOVE + 6) * options.zoom;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    if (dummy.detail) {
      ctx.font = FONT(13);
      options.outlinedText(dummy.detail, 0, top, "#dfe6ea", 3);
    }
    ctx.font = FONT(17);
    options.outlinedText(dummy.readout, 0, top - (dummy.detail ? 16 : 0), "#ffd869", 3);
    ctx.font = FONT(13);
    options.outlinedText("Training Dummy", 0, top - (dummy.detail ? 36 : 20), "#ffffff", 3);
  });
}
