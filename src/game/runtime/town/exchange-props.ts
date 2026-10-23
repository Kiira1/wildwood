/**
 * The Trade Chrysanthemum's painted pieces, in the ForestVillage pack's style (flat colours, soft shading, a dark
 * brown outline), as the Town's signpost is: the chrysanthemum bed in the square's middle and its banners.
 * Each is drawn from its foot, in world units.
 */
const OUTLINE = "#3b2a1e";

export type ExchangeProp = "chrysanthemumBed" | "exchangeBanner";
/** How far each reaches from its foot, for culling. */
export const EXCHANGE_PROP_EXTENTS: Readonly<Record<ExchangeProp, { left: number; right: number; up: number; down: number }>> = {
  chrysanthemumBed: { left: 100, right: 100, up: 150, down: 24 },
  exchangeBanner: { left: 30, right: 30, up: 150, down: 8 },
};

/** One chrysanthemum: rings of narrow petals round a small middle, seen a little from above. */
function bloom(c: CanvasRenderingContext2D, x: number, y: number, r: number, colors: readonly string[]) {
  const rings = colors.length - 1;
  for (let ring = 0; ring < rings; ring++) {
    const reach = r * (1 - ring / (rings + 1)), count = Math.max(8, Math.round(22 - ring * 5)), turn = ring * .37;
    c.fillStyle = colors[ring];
    c.strokeStyle = OUTLINE;
    c.lineWidth = ring ? 1 : 1.5;
    for (let petal = 0; petal < count; petal++) {
      const angle = turn + petal / count * Math.PI * 2;
      const px = x + Math.cos(angle) * reach * .55, py = y + Math.sin(angle) * reach * .55 * .72;
      c.beginPath();
      c.ellipse(px, py, reach * .5, Math.max(2, reach * .16), Math.atan2(Math.sin(angle) * .72, Math.cos(angle)), 0, Math.PI * 2);
      c.fill(); c.stroke();
    }
  }
  c.fillStyle = colors[rings];
  c.beginPath(); c.ellipse(x, y, r * .2, r * .15, 0, 0, Math.PI * 2); c.fill();
  c.lineWidth = 1; c.strokeStyle = OUTLINE; c.stroke();
}

const GOLD = ["#e9a426", "#f5c13e", "#ffe08a", "#b5651d"] as const;
const AMBER = ["#d9762b", "#ee9a3e", "#f8c36a", "#8f4a17"] as const;
const CREAM = ["#e6dcc4", "#f5efe0", "#fffaf0", "#c9a246"] as const;

/** A raised round bed of stone, soil and leaves, one great golden chrysanthemum in its middle and smaller ones round it. */
function drawBed(c: CanvasRenderingContext2D) {
  const rx = 92, ry = 50, cy = -ry, wall = 14;
  c.fillStyle = "rgba(20,14,8,.22)";
  c.beginPath(); c.ellipse(0, cy + wall + 6, rx + 6, ry + 4, 0, 0, Math.PI * 2); c.fill();
  // The kerb: its front face, then its top, cut into stones.
  c.lineWidth = 3; c.strokeStyle = OUTLINE;
  c.fillStyle = "#7f858c";
  c.beginPath(); c.ellipse(0, cy + wall, rx, ry, 0, 0, Math.PI); c.lineTo(-rx, cy); c.ellipse(0, cy, rx, ry, 0, Math.PI, 0, true); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = "#a9aeb3";
  c.beginPath(); c.ellipse(0, cy, rx, ry, 0, 0, Math.PI * 2); c.fill(); c.stroke();
  c.lineWidth = 1.5;
  for (let stone = 0; stone < 18; stone++) {
    const angle = stone / 18 * Math.PI * 2 + .1, cos = Math.cos(angle), sin = Math.sin(angle);
    c.beginPath(); c.moveTo(cos * (rx - 13), cy + sin * (ry - 11)); c.lineTo(cos * rx, cy + sin * ry);
    if (sin > .15) c.lineTo(cos * rx, cy + sin * ry + wall);
    c.stroke();
  }
  // Soil, and the leaves round its edge.
  c.fillStyle = "#5b3e2a";
  c.beginPath(); c.ellipse(0, cy, rx - 13, ry - 11, 0, 0, Math.PI * 2); c.fill();
  c.lineWidth = 1.5; c.stroke();
  c.fillStyle = "#3f6e35";
  for (let leaf = 0; leaf < 14; leaf++) {
    const angle = leaf / 14 * Math.PI * 2, lx = Math.cos(angle) * (rx - 26), ly = cy + Math.sin(angle) * (ry - 20);
    c.beginPath(); c.ellipse(lx, ly - 3, 11, 6, angle, 0, Math.PI * 2); c.fill(); c.stroke();
  }
  // The small blooms round the edge, back to front, then the great one, raised on its stems.
  const small = Array.from({ length: 10 }, (_, index) => {
    const angle = index / 10 * Math.PI * 2 + .3;
    return { x: Math.cos(angle) * (rx - 30), y: cy + Math.sin(angle) * (ry - 22) - 6, colors: [AMBER, CREAM, GOLD][index % 3] };
  }).sort((a, b) => a.y - b.y);
  const back = small.filter(item => item.y < cy - 6), front = small.filter(item => item.y >= cy - 6);
  for (const item of back) bloom(c, item.x, item.y, 15, item.colors);
  c.strokeStyle = "#2f5a2a"; c.lineWidth = 4;
  c.beginPath(); c.moveTo(0, cy + 4); c.lineTo(0, cy - 22); c.stroke();
  c.fillStyle = "#4f8a40"; c.strokeStyle = OUTLINE; c.lineWidth = 1.5;
  for (const side of [-1, 1]) { c.beginPath(); c.ellipse(side * 12, cy - 8, 13, 6, side * -.5, 0, Math.PI * 2); c.fill(); c.stroke(); }
  bloom(c, 0, cy - 32, 36, GOLD);
  for (const item of front) bloom(c, item.x, item.y, 15, item.colors);
}

/** A banner pole: a charcoal cloth, gold-trimmed, with a gold chrysanthemum on it, hung from a crossbar. */
function drawBanner(c: CanvasRenderingContext2D) {
  c.fillStyle = "rgba(20,14,8,.22)";
  c.beginPath(); c.ellipse(0, -2, 14, 5, 0, 0, Math.PI * 2); c.fill();
  c.lineJoin = "round";
  c.lineWidth = 3; c.strokeStyle = OUTLINE;
  // The pole and its gold cap.
  c.fillStyle = "#8a5d36";
  c.beginPath(); c.rect(-4, -138, 8, 138); c.fill(); c.stroke();
  c.fillStyle = "#e9b23a";
  c.beginPath(); c.arc(0, -142, 6, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = "#8a5d36";
  c.beginPath(); c.rect(-24, -130, 48, 6); c.fill(); c.stroke();
  // The cloth, swallow-tailed.
  c.fillStyle = "#2a2b2f";
  c.beginPath(); c.moveTo(-20, -124); c.lineTo(20, -124); c.lineTo(20, -52); c.lineTo(0, -62); c.lineTo(-20, -52); c.closePath(); c.fill(); c.stroke();
  c.strokeStyle = "#d9a63a"; c.lineWidth = 2;
  c.beginPath(); c.moveTo(-15, -118); c.lineTo(15, -118); c.lineTo(15, -59); c.lineTo(0, -67); c.lineTo(-15, -59); c.closePath(); c.stroke();
  bloom(c, 0, -94, 13, GOLD);
}

export function drawExchangeProp(c: CanvasRenderingContext2D, kind: ExchangeProp, x: number, y: number) {
  c.save();
  c.translate(x, y);
  c.lineJoin = "round";
  if (kind === "chrysanthemumBed") drawBed(c); else drawBanner(c);
  c.restore();
}
