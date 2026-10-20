type OutlinedText = (text: string, x: number, y: number, color: string, strokeWidth?: number) => void;

// Built once per scale rather than every frame.
const fonts = new Map<number, string>();
function powerFont(scale: number) {
  let font = fonts.get(scale);
  if (!font) fonts.set(scale, font = `900 ${+(10 * scale).toFixed(2)}px "Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif`);
  return font;
}

/** One rendering path for overhead power in the world and character previews. */
export function drawPlayerPowerLabel(
  ctx: CanvasRenderingContext2D,
  outlinedText: OutlinedText,
  icon: HTMLCanvasElement | ImageBitmap | null,
  value: string,
  centerX: number,
  bottom: number,
  /** The world's overhead plates pass NAMEPLATE_SCALE; previews keep the full size. */
  scale = 1,
) {
  ctx.save();
  // 10px at full size, as the name above it and the health bar's numbers.
  ctx.font = powerFont(scale);
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  const hasIcon = Boolean(icon);
  const iconSize = hasIcon ? 16 * scale : 0;
  const iconGap = hasIcon ? 3 * scale : 0;
  const textWidth = ctx.measureText(value).width;
  const left = centerX - (textWidth + iconSize + iconGap) / 2;
  outlinedText(value, left, bottom, "#ffffff", 4 * scale);
  if (hasIcon) {
    ctx.imageSmoothingEnabled = true;
    // Centred on the digits rather than sitting on their baseline: the glyphs
    // are cap-height, so the icon's middle belongs a little above the bottom.
    // The two pixels back down are measured against the drawn artwork, whose
    // ink sits high in its own square.
    const textHeight = 10 * scale;
    const opticalDrop = scale;
    ctx.drawImage(icon!, left + textWidth + iconGap, bottom - textHeight / 2 - iconSize / 2 + opticalDrop, iconSize, iconSize);
  }
  ctx.restore();
}
