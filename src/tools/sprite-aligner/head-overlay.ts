import { EXPANSION_HEAD_REVISION } from "../../game/player-head-template";

import type { LayerBounds } from "../../game/player-layer-alignment";

// Same source coordinates as the game's expansion head mask; no eye-based scaling.
export function headOverlayRegistration(id: string) {
  return id === "expansion" ? { scale: 1, x: 0, y: 0 } : null;
}
const images = new Map<string, HTMLImageElement>();
export function drawHeadOverlay(ctx: CanvasRenderingContext2D, head: LayerBounds | undefined, id: string, opacity: number, redraw: () => void) {
  const registration = headOverlayRegistration(id);
  if (!registration || !head?.transform || !head.source) return;
  let image = images.get(id);
  if (!image) {
    image = new Image(); images.set(id, image);
    image.addEventListener("load", redraw, { once: true });
    image.addEventListener("error", () => {
      document.getElementById("overlayStatus")!.textContent = "Reference image unavailable in the local vendor folder.";
    }, { once: true });
    image.src = "../public/assets/wildstat/player-parts/expansion-head-template.png?v=" + EXPANSION_HEAD_REVISION;
  }
  if (!image.complete || !image.naturalWidth) return;
  const m = head.transform;
  ctx.save(); ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.drawImage(image, head.source.x + registration.x, head.source.y + registration.y,
    image.naturalWidth * registration.scale, image.naturalHeight * registration.scale);
  ctx.restore();
}
