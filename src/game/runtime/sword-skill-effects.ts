import type { SkillEffect } from "./combat-effects";

/** Sword effects stay in the same bounded pool and world layer as the bow effects. */
export function drawSwordSkillEffect(ctx: CanvasRenderingContext2D, effect: SkillEffect,
  camera: { x: number; y: number }, progress: number) {
  const fade = 1 - progress;
  const x = (effect.anchor?.x ?? effect.x) - camera.x, y = (effect.anchor?.y ?? effect.y) - camera.y;
  ctx.save();
  if (effect.kind === "spin") {
    ctx.translate(x, y - 12);
    ctx.scale(1, .52);
    const angle = progress * Math.PI * 6;
    for (const [width, alpha, color] of [[18, .12, "#ffc85c"], [8, .4, "#ffdb79"], [2.5, .95, "#fff9dc"]] as const) {
      ctx.lineWidth = width; ctx.strokeStyle = color; ctx.globalAlpha = alpha * Math.min(1, fade * 5);
      for (let trail = 0; trail < 3; trail++) {
        const start = angle + trail * Math.PI * 2 / 3;
        ctx.beginPath(); ctx.arc(0, 0, effect.width * (1 - trail * .11), start - 1.8, start); ctx.stroke();
      }
    }
  } else {
    const dx = effect.toX - effect.x, dy = effect.toY - effect.y;
    ctx.translate(x + dx * progress, y + dy * progress);
    ctx.rotate(Math.atan2(dy, dx));
    if (effect.kind === "wave") {
      // A bright leading crescent and two fading wake lines travel with the hit.
      for (const [offset, width, alpha, color] of [[-15, 10, .12, "#71d7ff"], [-7, 6, .4, "#9cecff"], [0, 2.5, 1, "#efffff"]] as const) {
        ctx.lineWidth = width; ctx.strokeStyle = color; ctx.globalAlpha = alpha * Math.min(1, fade * 6);
        ctx.beginPath(); ctx.arc(offset, 0, effect.width, -Math.PI * .45, Math.PI * .45); ctx.stroke();
      }
    } else {
      // A returned projectile has a compact bright head and a blue tail.
      for (const [width, alpha, color] of [[10, .22, "#60baff"], [3, .95, "#d4f4ff"]] as const) {
        ctx.lineWidth = width; ctx.strokeStyle = color; ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.moveTo(-28, 0); ctx.lineTo(0, 0); ctx.stroke();
      }
      ctx.fillStyle = "#ffffff"; ctx.beginPath();
      ctx.moveTo(7, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}
