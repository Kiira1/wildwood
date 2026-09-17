type OutlinedText = (text: string, x: number, y: number, color: string, strokeWidth?: number) => void;

/** One rendering path for overhead power in the world and character previews. */
export function drawPlayerPowerLabel(
  ctx: CanvasRenderingContext2D,
  outlinedText: OutlinedText,
  icon: HTMLImageElement,
  value: string,
  centerX: number,
  bottom: number,
) {
  ctx.save();
  ctx.font = '900 12px "Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif';
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  const hasIcon = icon.complete && icon.naturalWidth > 0;
  const iconSize = hasIcon ? 16 : 0;
  const iconGap = hasIcon ? 3 : 0;
  const textWidth = ctx.measureText(value).width;
  const left = centerX - (textWidth + iconSize + iconGap) / 2;
  outlinedText(value, left, bottom, "#ffffff", 4);
  if (hasIcon) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(icon, left + textWidth + iconGap, bottom - iconSize + 1, iconSize, iconSize);
  }
  ctx.restore();
}
