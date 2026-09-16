import { ATTACK_ANIMATION_SECONDS } from "./attack-timeline";

const smooth = (t: number) => t * t * (3 - 2 * t);
/** Shares the normal attack clock; the blade crosses aim at the damage release. */
export function swordSwingPose(throwClock: number) {
  if (throwClock <= 0) return { angle: -28, trail: 0 };
  const elapsed = Math.max(0, ATTACK_ANIMATION_SECONDS - throwClock);
  let angle: number;
  if (elapsed < .075) angle = -28 - 72 * smooth(elapsed / .075);
  else if (elapsed < .12) angle = -100 + 100 * smooth((elapsed - .075) / .045);
  else if (elapsed < .19) angle = 100 * smooth((elapsed - .12) / .07);
  else angle = 100 - 128 * smooth(Math.min(1, (elapsed - .19) / .23));
  const trail = elapsed >= .09 && elapsed < .27 ? Math.sin((elapsed - .09) / .18 * Math.PI) : 0;
  return { angle, trail };
}

export function drawSwordTrail(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number, opacity: number) {
  if (opacity <= 0) return;
  ctx.save();
  ctx.lineCap = "round";
  for (const [width, alpha] of [[12, .12], [6, .28], [2, .85]]) {
    ctx.globalAlpha *= alpha * opacity;
    ctx.strokeStyle = "#f3f7ff";
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.arc(x, y, radius, angle - 1.15, angle); ctx.stroke();
    ctx.globalAlpha /= alpha * opacity;
  }
  ctx.restore();
}
