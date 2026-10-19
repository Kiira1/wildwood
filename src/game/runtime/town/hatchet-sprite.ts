import type { WorldSpritePresentation } from "../../item-presentation";
import { PICKAXE_PRESENTATION, PLAIN_STEEL, type ToolMetal } from "./pickaxe-sprite";

/**
 * The Smith's hatchet, held while chopping in place of the player's weapon, as the pickaxe is held while mining: not
 * an item, drawn at the wooden sword's size with its grip where the sword's is, so it swings on the sword's swing.
 */
export const WOODCUTTING_HATCHET = "woodcutting_hatchet";
export const HATCHET_OVERRIDES: Readonly<Record<string, WorldSpritePresentation>> = Object.freeze({ [WOODCUTTING_HATCHET]: PICKAXE_PRESENTATION });

const OUTLINE = "#14100c";
const WOOD = "#9b6a3f", WOOD_LIGHT = "#cf9a62", WRAP = "#5a3b22";

/** Paints the hatchet into a 118 × 59 canvas (the wooden sword's size): the grip on the left, a broad bit at the far end. */
export function paintHatchet(c: CanvasRenderingContext2D, metal: ToolMetal = PLAIN_STEEL) {
  c.lineJoin = "round"; c.lineCap = "round";
  const line = (width: number, color: string, from: [number, number], to: [number, number]) => {
    c.lineWidth = width; c.strokeStyle = color;
    c.beginPath(); c.moveTo(...from); c.lineTo(...to); c.stroke();
  };
  // The haft, as the pickaxe's, a little shorter.
  line(14, OUTLINE, [14, 30], [84, 30]);
  line(8, WOOD, [14, 30], [84, 30]);
  line(3, WOOD_LIGHT, [17, 27], [82, 27]);
  line(8, WRAP, [15, 30], [32, 30]);
  // The head: a cheek on the haft's end, flaring to a broad curved bit on one side.
  const head = () => {
    c.beginPath();
    c.moveTo(70, 22); c.lineTo(88, 22); c.lineTo(92, 12); c.quadraticCurveTo(104, 26, 92, 54);
    c.lineTo(84, 40); c.lineTo(70, 40); c.closePath();
  };
  head(); c.lineWidth = 6; c.strokeStyle = OUTLINE; c.stroke();
  head(); c.fillStyle = metal.dark; c.fill();
  c.save(); head(); c.clip(); c.fillStyle = metal.light; c.fillRect(60, 0, 50, 29); c.restore();
  // The ground edge, bright along the bit.
  c.lineWidth = 2.5; c.strokeStyle = metal.edge;
  c.beginPath(); c.moveTo(93, 15); c.quadraticCurveTo(102, 27, 93, 50); c.stroke();
}

/** The hatchet as an image the player's drawing can hold, or nothing where there is no canvas (tests). */
export function createHatchetSprite(metal: ToolMetal = PLAIN_STEEL): HTMLImageElement | undefined {
  if (typeof document === "undefined" || typeof Image === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 118; canvas.height = 59;
  const context = canvas.getContext?.("2d");
  if (!context) return undefined;
  paintHatchet(context, metal);
  const image = new Image();
  image.src = canvas.toDataURL("image/png");
  return image;
}
