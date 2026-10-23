/**
 * The Town square's signpost: a wooden post with one arrow plank, painted in the
 * ForestVillage pack's style (warm wood, dark brown outline), its label on the
 * plank (or two lines of it, split at a line break). The plank points left and a little up, the way to the travel portal;
 * mirrored, it points right, as the Copper Hills sign by the Smith's yard does.
 */
const OUTLINE = "#3b2a1e";
const WOOD = "#b47b48";
const WOOD_LIGHT = "#cf9a62";
const POST = "#9b6a3f";

/** How far the signpost reaches from its foot, for culling. */
export const TOWN_SIGNPOST_EXTENT = Object.freeze({ left: 80, right: 56, up: 128, down: 10 });
export const TOWN_SIGNPOST_EXTENT_MIRRORED = Object.freeze({ left: 56, right: 80, up: 128, down: 10 });

function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}

/** Draws the signpost with its foot at (x, y), in the canvas's current (world) units; `mirrored` points it right. */
export function drawTownSignpost(c: CanvasRenderingContext2D, x: number, y: number, label: string, mirrored = false) {
  c.save();
  c.translate(x, y);
  c.lineJoin = "round";
  // Its shadow on the cobbles.
  c.fillStyle = "rgba(20,14,8,.22)";
  c.beginPath(); c.ellipse(0, -2, 22, 7, 0, 0, Math.PI * 2); c.fill();
  // The post, with its rounded cap.
  c.lineWidth = 3; c.strokeStyle = OUTLINE;
  rounded(c, -7, -112, 14, 112, 6); c.fillStyle = POST; c.fill(); c.stroke();
  c.fillStyle = WOOD_LIGHT; c.fillRect(-3, -106, 3, 100);
  // The arrow plank, tilted so its point is raised: up the road, towards the portal.
  c.save();
  if (mirrored) c.scale(-1, 1);
  c.translate(-6, -76);
  c.rotate(.18);
  c.beginPath();
  c.moveTo(-64, 0); c.lineTo(-46, -19); c.lineTo(52, -19); c.quadraticCurveTo(58, -19, 58, -13);
  c.lineTo(58, 13); c.quadraticCurveTo(58, 19, 52, 19); c.lineTo(-46, 19); c.closePath();
  c.fillStyle = WOOD; c.fill();
  c.lineWidth = 3; c.stroke();
  c.strokeStyle = WOOD_LIGHT; c.lineWidth = 2;
  c.beginPath(); c.moveTo(-44, -14); c.lineTo(52, -14); c.stroke();
  c.font = '900 17px "Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif';
  c.textAlign = "center"; c.textBaseline = "middle";
  c.strokeStyle = OUTLINE; c.lineWidth = 4; c.fillStyle = "#fff1d2";
  // The label reads the right way round whichever way the plank points.
  if (mirrored) c.scale(-1, 1);
  const textX = mirrored ? -2 : 2;
  // A label on two lines (split at a line break) is set smaller, a line each side of the plank's middle.
  const lines = label.split("\n");
  if (lines.length > 1) c.font = '900 13px "Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif';
  lines.forEach((line, index) => {
    const lineY = lines.length > 1 ? (index - (lines.length - 1) / 2) * 14 + 1 : 1;
    c.strokeText(line, textX, lineY, 100); c.fillText(line, textX, lineY, 100);
  });
  c.restore();
  c.restore();
}
