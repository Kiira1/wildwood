import type { SkillEffect } from "./combat-effects";
import { FIRE_COLOR, FROST_COLOR, lightStaffEffects } from "../staff-look";

/** How long a bolt's burst, a meteor's blast after it lands and a frost nova show. */
export const STAFF_BURST_SECONDS = .28;
export const METEOR_BLAST_SECONDS = .4;
export const FROST_NOVA_EFFECT_SECONDS = .45;

const groundRing = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) => {
  ctx.beginPath(); ctx.ellipse(x, y, radius, radius * .45, 0, 0, Math.PI * 2);
};

/**
 * Staff effects, from the same bounded pool as the bow and sword ones: a few arcs, ellipses and lines each,
 * never particles. `width` carries the radius; a meteor's `warning` is the time before its fireball lands.
 */
export function drawStaffSkillEffect(ctx: CanvasRenderingContext2D, effect: SkillEffect, camera: { x: number; y: number }) {
  const x = effect.x - camera.x, y = effect.y - camera.y, radius = effect.width;
  const elapsed = effect.maxLife - effect.life;
  ctx.save();
  if (effect.kind === "burst") {
    // A bright flash at the impact and a ring that runs out to the splash radius.
    const progress = Math.min(1, elapsed / STAFF_BURST_SECONDS), fade = 1 - progress;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = .45 * fade;
    ctx.fillStyle = effect.color;
    ctx.beginPath(); ctx.arc(x, y - 8, 10 + radius * .3 * progress, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .9 * fade * fade;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(x, y - 8, 7 * fade + 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = .8 * fade;
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 2.5 * fade + 1;
    groundRing(ctx, x, y + 6, radius * (.35 + .65 * progress)); ctx.stroke();
  } else if (effect.kind === "meteor") {
    const warning = effect.warning ?? 0;
    if (elapsed < warning) {
      // The warning: a ring on the ground fills in, and the fireball drops through the last of it.
      const charge = elapsed / warning;
      ctx.globalAlpha = .5 + .3 * Math.sin(elapsed * 22);
      ctx.strokeStyle = FIRE_COLOR;
      ctx.lineWidth = 2;
      groundRing(ctx, x, y + 6, radius); ctx.stroke();
      if (!lightStaffEffects()) {
        ctx.globalAlpha = .18;
        ctx.fillStyle = FIRE_COLOR;
        groundRing(ctx, x, y + 6, radius * charge); ctx.fill();
      }
      const fall = Math.max(0, (charge - .45) / .55);
      if (fall > 0) {
        const fromX = x + 90, fromY = y - 320, fx = fromX + (x - fromX) * fall * fall, fy = fromY + (y - fromY) * fall * fall;
        ctx.globalAlpha = .55;
        ctx.strokeStyle = FIRE_COLOR;
        ctx.lineWidth = 9;
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(fx + 18, fy - 62); ctx.lineTo(fx, fy); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = FIRE_COLOR;
        ctx.beginPath(); ctx.arc(fx, fy, 13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff2c4";
        ctx.beginPath(); ctx.arc(fx, fy, 6, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      // The blast: a flash and a wide ring running out past the warning.
      const progress = Math.min(1, (elapsed - warning) / METEOR_BLAST_SECONDS), fade = 1 - progress;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = .5 * fade;
      ctx.fillStyle = FIRE_COLOR;
      groundRing(ctx, x, y + 6, radius * (.5 + .5 * progress)); ctx.fill();
      ctx.globalAlpha = .9 * fade * fade;
      ctx.fillStyle = "#fff2c4";
      ctx.beginPath(); ctx.arc(x, y - 6, 26 * fade + 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = fade;
      ctx.strokeStyle = "#ffd28a";
      ctx.lineWidth = 4 * fade + 1;
      groundRing(ctx, x, y + 6, radius * (.6 + .55 * progress)); ctx.stroke();
    }
  } else {
    // Frost Nova: an ice ring bursting out, with a quick flash of crystal shards around it.
    const progress = Math.min(1, elapsed / FROST_NOVA_EFFECT_SECONDS), fade = 1 - progress;
    const ring = radius * (.2 + .8 * Math.sqrt(progress));
    ctx.globalAlpha = .9 * fade;
    ctx.strokeStyle = FROST_COLOR;
    ctx.lineWidth = 3 * fade + 1;
    groundRing(ctx, x, y + 6, ring); ctx.stroke();
    if (!lightStaffEffects() && progress < .6) {
      ctx.globalAlpha = 1 - progress / .6;
      ctx.strokeStyle = "#f2fdff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let shard = 0; shard < 8; shard++) {
        const angle = shard / 8 * Math.PI * 2 + .2, cos = Math.cos(angle), sin = Math.sin(angle) * .45;
        ctx.moveTo(x + cos * ring * .7, y + 6 + sin * ring * .7);
        ctx.lineTo(x + cos * (ring * .7 + 14), y + 6 + sin * (ring * .7 + 14) - 10);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}
