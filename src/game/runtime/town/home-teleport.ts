import { createGlowCache } from "../render/glow-cache";

/** Shared presentation clock for the local player's departure and arrival. */
let startedAt: number | null = null;
let arriving = false;
export function beginHomeTeleport(arrival = false) {
  startedAt = performance.now();
  arriving = arrival;
}
export function endHomeTeleport() { startedAt = null; }

// Glows are baked or layered: a live shadowBlur made Firefox draw every frame on the CPU.
const GLOW = "#96eeff";
/** Wide faint strokes under the ring, standing in for its blur: [line width, alpha]. */
const RING_GLOW: readonly (readonly [number, number])[] = [[18, .07], [11, .12], [6, .2]];
const sparkGlow = createGlowCache();
let spark: HTMLCanvasElement | null = null;
let halo: HTMLCanvasElement | null = null;

function bakedSpark() {
  if (spark || typeof document === "undefined") return spark;
  const canvas = document.createElement("canvas");
  canvas.width = 4; canvas.height = 8;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#c5f9ff";
  context.fillRect(0, 0, 4, 8);
  return spark = canvas;
}

/** A soft cyan disc drawn behind the player, where the shadow used to outline them. */
function bakedHalo() {
  if (halo || typeof document === "undefined") return halo;
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(150,238,255,.55)");
  gradient.addColorStop(.6, "rgba(150,238,255,.22)");
  gradient.addColorStop(1, "rgba(150,238,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return halo = canvas;
}

export function drawHomeTeleport(ctx: CanvasRenderingContext2D, x: number, y: number, drawPlayer: () => void) {
  const elapsed = startedAt === null ? 0 : performance.now() - startedAt;
  // Presentation must recover even if its owning transition is interrupted.
  if (startedAt !== null && elapsed >= (arriving ? 650 : 30_000)) endHomeTeleport();
  const progress = startedAt === null ? 1 : Math.min(1, elapsed / 650);
  if (progress >= 1) { if (startedAt === null || arriving) drawPlayer(); return; }
  const strength = Math.sin(progress * Math.PI);
  const ringAlpha = 1 - progress * .5;
  const radiusX = 24 + strength * 35, radiusY = 10 + strength * 15;
  ctx.save();
  for (const [width, alpha] of RING_GLOW) {
    ctx.strokeStyle = `rgba(150,238,255,${ringAlpha * alpha})`;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.strokeStyle = `rgba(143,241,255,${ringAlpha})`;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2); ctx.stroke();
  const sparkImage = bakedSpark();
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4 + progress * Math.PI * 2;
    const sparkX = x + Math.cos(angle) * 28 - 2, sparkY = y - progress * 110 + Math.sin(angle) * 12;
    if (sparkImage) sparkGlow(ctx, sparkImage, sparkImage, sparkX, sparkY, 4, 8, GLOW, 18);
    ctx.fillStyle = '#c5f9ff';
    ctx.fillRect(sparkX, sparkY, 4, 8);
  }
  ctx.globalAlpha *= arriving ? progress : 1 - progress;
  ctx.translate(x, y);
  ctx.scale(1 - strength * .25, 1 + strength * .2);
  ctx.translate(-x, -y + (arriving ? -(1 - progress) : -progress) * 24);
  const haloImage = bakedHalo();
  if (haloImage) ctx.drawImage(haloImage, x - 34, y - 44, 68, 88);
  drawPlayer();
  ctx.restore();
}
