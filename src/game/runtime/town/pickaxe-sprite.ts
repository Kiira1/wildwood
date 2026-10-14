import type { WorldSpritePresentation } from "../../item-presentation";

/**
 * The Smith's pickaxe, held while mining in place of the player's weapon. Not an item: it lives only in the hand,
 * drawn here at the wooden sword's size with its grip where the sword's is, so it swings on the sword's own
 * alignment and swing (sword-swing.ts).
 */
export const MINING_PICKAXE = "mining_pickaxe";
export const PICKAXE_PRESENTATION: WorldSpritePresentation = { kind: "SPRITE", source: "", layer: "HAND", top: 116, handAction: "SWING", weaponCategory: "SWORD" };
export const PICKAXE_OVERRIDES: Readonly<Record<string, WorldSpritePresentation>> = Object.freeze({ [MINING_PICKAXE]: PICKAXE_PRESENTATION });

const OUTLINE = "#14100c";
const WOOD = "#9b6a3f", WOOD_LIGHT = "#cf9a62", WRAP = "#5a3b22";
const STEEL = "#c7d0d6", STEEL_DARK = "#8995a0";

/**
 * Paints the pickaxe into a 118 × 59 canvas (the wooden sword's size): the grip on the left, the head at the far end,
 * about as long overall as the sword.
 */
export function paintPickaxe(c: CanvasRenderingContext2D) {
  c.lineJoin = "round"; c.lineCap = "round";
  const line = (width: number, color: string, from: [number, number], to: [number, number]) => {
    c.lineWidth = width; c.strokeStyle = color;
    c.beginPath(); c.moveTo(...from); c.lineTo(...to); c.stroke();
  };
  // The haft, outlined like the sword, lit along its top, wrapped at the grip.
  line(14, OUTLINE, [14, 30], [78, 30]);
  line(8, WOOD, [14, 30], [78, 30]);
  line(3, WOOD_LIGHT, [17, 27], [76, 27]);
  line(8, WRAP, [15, 30], [32, 30]);
  // The head: a deep steel bar across the haft's end, thick at the eye, tapering to points bent back towards the hand.
  const head = () => {
    c.beginPath();
    c.moveTo(72, 4); c.quadraticCurveTo(94, 9, 96, 21); c.lineTo(96, 39); c.quadraticCurveTo(94, 51, 72, 56);
    c.quadraticCurveTo(80, 47, 77, 38); c.lineTo(77, 22); c.quadraticCurveTo(80, 13, 72, 4); c.closePath();
  };
  head(); c.lineWidth = 6; c.strokeStyle = OUTLINE; c.stroke();
  head(); c.fillStyle = STEEL_DARK; c.fill();
  c.save(); head(); c.clip(); c.fillStyle = STEEL; c.fillRect(60, 0, 50, 30); c.restore();
  // The eye where the haft goes through, lit on top like the head.
  c.fillStyle = OUTLINE; c.fillRect(74, 20, 17, 20);
  c.fillStyle = STEEL_DARK; c.fillRect(76, 22, 13, 16);
  c.fillStyle = STEEL; c.fillRect(76, 22, 13, 7);
}

/** The pickaxe as an image the player's drawing can hold, or nothing where there is no canvas (tests). */
export function createPickaxeSprite(): HTMLImageElement | undefined {
  if (typeof document === "undefined" || typeof Image === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 118; canvas.height = 59;
  const context = canvas.getContext?.("2d");
  if (!context) return undefined;
  paintPickaxe(context);
  const image = new Image();
  image.src = canvas.toDataURL("image/png");
  return image;
}
