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

/** Paints the pickaxe into a 118 × 59 canvas (the wooden sword's size): the grip on the left, the head at the far end. */
export function paintPickaxe(c: CanvasRenderingContext2D) {
  c.lineJoin = "round"; c.lineCap = "round";
  const line = (width: number, color: string, from: [number, number], to: [number, number]) => {
    c.lineWidth = width; c.strokeStyle = color;
    c.beginPath(); c.moveTo(...from); c.lineTo(...to); c.stroke();
  };
  // The haft, outlined like the sword, lit along its top, wrapped at the grip.
  line(15, OUTLINE, [10, 30], [100, 30]);
  line(8, WOOD, [10, 30], [100, 30]);
  line(3, WOOD_LIGHT, [13, 27], [97, 27]);
  line(8, WRAP, [12, 30], [30, 30]);
  // The head: a curved steel bar across the haft's end, its points bent back towards the hand.
  const head = () => {
    c.beginPath();
    c.moveTo(86, 6); c.quadraticCurveTo(116, 14, 112, 30); c.quadraticCurveTo(116, 46, 86, 53);
    c.quadraticCurveTo(102, 42, 100, 30); c.quadraticCurveTo(102, 18, 86, 6); c.closePath();
  };
  head(); c.lineWidth = 6; c.strokeStyle = OUTLINE; c.stroke();
  head(); c.fillStyle = STEEL_DARK; c.fill();
  c.save(); head(); c.clip(); c.fillStyle = STEEL; c.fillRect(80, 0, 40, 30); c.restore();
  // The socket where the haft goes through.
  c.fillStyle = OUTLINE; c.fillRect(96, 23, 9, 14);
  c.fillStyle = STEEL_DARK; c.fillRect(98, 25, 5, 10);
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
