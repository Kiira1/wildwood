import { ATTACK_ANIMATION_SECONDS } from "./attack-timeline";
import { freezeCopy, frozenCopyOf } from "./runtime/render/frozen-canvas";

/** Each staff's bolt colour, from its art; elemental effects keep their own (fire, lightning, frost). */
const STAFF_BOLT_COLORS: Readonly<Record<string, string>> = {
  starter_staff: "#ffe1a0", forest_staff: "#7fe6d0", desert_staff: "#ffd27a", snow_staff: "#a6e4ff",
  lava_staff: "#ff8a3d", night_staff: "#c48bff", sky_staff: "#62b8ff", samurai_staff: "#ff6b78",
  cloudspire_staff: "#ffdc5a", moonfen_staff: "#eef3ff", crystal_staff: "#72f2ff", clockwork_staff: "#ffc44d",
  duskfall_staff: "#ff9fd2", neon_staff: "#7dffd1", verdant_staff: "#dfe8c9", ion_staff: "#b68cff",
};
export const staffBoltColor = (itemId: string | undefined) => STAFF_BOLT_COLORS[itemId ?? ""] ?? "#d9c6ff";
export const FIRE_COLOR = "#ff8a2b";
export const FROST_COLOR = "#a8ecff";

/** Low Performance Mode drops the decorative parts: the rune circle and the frost shards. */
let light = false;
export const lightStaffEffects = () => light;
export function setLightStaffEffects(next: boolean) { light = next; }

const smooth = (t: number) => t * t * (3 - 2 * t);
/**
 * The cast on the normal attack clock: the staff rises and leans back, thrusts forward through the release
 * (.12 s in), holds a moment and settles. About .36 s in all, shorter than any cast interval allows.
 */
export function staffCastPose(throwClock: number) {
  const elapsed = throwClock > 0 ? Math.max(0, ATTACK_ANIMATION_SECONDS - throwClock) : Infinity;
  if (elapsed < .08) {
    const k = smooth(elapsed / .08);
    return { lift: 10 * k, forward: -2 * k, tilt: -.18 * k, glow: .8 * k, rune: elapsed };
  }
  if (elapsed < .14) {
    const k = smooth((elapsed - .08) / .06);
    return { lift: 10 - 6 * k, forward: -2 + 10 * k, tilt: -.18 + .68 * k, glow: .8 + .2 * k, rune: elapsed };
  }
  if (elapsed < .22) return { lift: 4, forward: 8, tilt: .5, glow: 1 - (elapsed - .14) / .08, rune: elapsed };
  if (elapsed < .36) {
    const k = 1 - smooth((elapsed - .22) / .14);
    return { lift: 4 * k, forward: 8 * k, tilt: .5 * k, glow: 0, rune: elapsed };
  }
  return { lift: 0, forward: 0, tilt: 0, glow: 0, rune: Infinity };
}
/** How long the rune circle shows at the caster's feet. */
export const STAFF_RUNE_SECONDS = .3;

/** A glow gathering at the staff's head: two filled circles, added light. */
export function drawStaffTipGlow(ctx: CanvasRenderingContext2D, x: number, y: number, glow: number, color: string) {
  if (glow <= 0) return;
  ctx.save();
  ctx.globalAlpha *= .3 * glow;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, 6 + 8 * glow, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha /= .35;
  ctx.globalAlpha *= .9;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(x, y, 2.5 + 2.5 * glow, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** A thin rune circle at the caster's feet that widens and fades: one ellipse and six ticks. */
export function drawStaffRune(ctx: CanvasRenderingContext2D, x: number, y: number, elapsed: number, color: string) {
  if (light || !(elapsed >= 0 && elapsed < STAFF_RUNE_SECONDS)) return;
  const progress = elapsed / STAFF_RUNE_SECONDS, fade = 1 - progress;
  const rx = 26 + 10 * progress, ry = rx * .38;
  ctx.save();
  ctx.globalAlpha *= .85 * fade;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  for (let tick = 0; tick < 6; tick++) {
    const angle = tick / 6 * Math.PI * 2 + progress * 1.4;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    ctx.moveTo(x + cos * rx * .72, y + sin * ry * .72);
    ctx.lineTo(x + cos * rx * .9, y + sin * ry * .9);
  }
  ctx.stroke();
  ctx.restore();
}

const boltSprites = new Map<string, HTMLCanvasElement>();
/**
 * A bolt as one cached image: a bright orb with a fading tail behind it, drawn once per colour and then only
 * stamped, rotated to its flight. The orb sits at the image's centre; the tail fills its left half.
 */
export function boltSprite(color: string): HTMLCanvasElement | null {
  const cached = boltSprites.get(color);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 24;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const tail = ctx.createLinearGradient(4, 0, 32, 0);
  tail.addColorStop(0, "rgba(255,255,255,0)");
  tail.addColorStop(1, color);
  ctx.globalAlpha = .55;
  ctx.fillStyle = tail;
  ctx.beginPath(); ctx.moveTo(4, 12); ctx.lineTo(32, 6); ctx.lineTo(32, 18); ctx.closePath(); ctx.fill();
  const orb = ctx.createRadialGradient(32, 12, 0, 32, 12, 11);
  orb.addColorStop(0, "#ffffff");
  orb.addColorStop(.35, color);
  orb.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = orb;
  ctx.beginPath(); ctx.arc(32, 12, 11, 0, Math.PI * 2); ctx.fill();
  boltSprites.set(color, canvas);
  // The canvas stays the WebGL layer's texture key; drawBolt draws its frozen copy.
  freezeCopy(canvas);
  return canvas;
}

/** Stamps a bolt at (x, y), pointing along `angle`. */
export function drawBolt(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string) {
  const sprite = boltSprite(color);
  if (!sprite) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); return; }
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.drawImage(frozenCopyOf(sprite), -sprite.width / 2, -sprite.height / 2);
  ctx.restore();
}
