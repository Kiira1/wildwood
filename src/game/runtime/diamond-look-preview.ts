import { DIAMOND_GALAXY_ARMOR, DIAMOND_GALAXY_BOOTS, DIAMOND_GALAXY_BOW, DIAMOND_GALAXY_HELMET } from "../../../shared/items";
import { PATREON_DIAMOND_ITEM_IDS } from "../../../shared/patreon-cosmetics";
import { DEFAULT_SKIN_TONE, drawStartingPlayer, playerPartsReady, type PlayerAppearanceAssets } from "../player-appearance";
import { keepCanvasMoving } from "../../app/moving-canvases";
import { canvasRenderPixelRatio } from "./render/render-budget";
import { requiredCanvasContext } from "./dom";

/** Draws a player in the Diamond Galaxy set, standing still, and again once its parts have loaded. */
export function createDiamondLookDrawer(assets: PlayerAppearanceAssets) {
  return function draw(canvas: HTMLCanvasElement, tries = 40) {
    const ready = playerPartsReady(assets, PATREON_DIAMOND_ITEM_IDS);
    const ctx = requiredCanvasContext(canvas);
    const ratio = canvasRenderPixelRatio(window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(canvas.clientWidth)), height = Math.max(1, Math.round(canvas.clientHeight));
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    const scale = height / 130;
    drawStartingPlayer(ctx, assets, {
      x: width / 2, y: height - scale * 42 - 3, facing: 0, moving: false, gameTime: 0, skinTone: DEFAULT_SKIN_TONE,
      headItem: DIAMOND_GALAXY_HELMET, chestItem: DIAMOND_GALAXY_ARMOR, feetItem: DIAMOND_GALAXY_BOOTS, rightHandItem: DIAMOND_GALAXY_BOW,
      scale,
    });
    // The galaxy finish moves, so the canvas keeps being redrawn while the Shop shows it.
    keepCanvasMoving(canvas, () => draw(canvas, 0));
    if (!ready && tries > 0) setTimeout(() => draw(canvas, tries - 1), 250);
  };
}
