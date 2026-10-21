import { ENEMY_SPRITE_LAYOUTS } from "../game/enemy-sprite-layouts.mjs";
import type { EnemySpriteSource } from "../game/enemies";
import { createTintedImageCanvas } from "../game/runtime/render/image-tint";
import { BOSS_ART } from "../game/runtime/boss/boss-art";
import { bossForMap, type BossDefinition, type BossKind } from "../game/runtime/boss/boss-registry";
import { removeGreenPixels } from "../game/runtime/render/sprite-pixels";
import { drawBossSheetFrame } from "../game/runtime/boss/boss-frame-crop";
import { CARAPACE_ANGLER_ATLAS } from "../game/runtime/boss/carapace-angler-sprite";
import { IRONHORN_ATLAS } from "../game/runtime/boss/ironhorn-sprite";
import { DREADREAPER_ATLAS } from "../game/runtime/boss/dreadreaper-sprite";
import { PRISMSHELL_ATLAS } from "../game/runtime/boss/prismshell-sprite";
import { cardDefinition, type CardDefinition, type CardRarity } from "../../shared/cards";
import { SOUL_ATLAS_SOURCE, soulFrame } from "../game/runtime/soul/soul-prop-renderer";
import { woodTreeFrame } from "../game/town-world";
import type { WoodTreeKind } from "../../shared/woodcutting";

/** Portrait size in CSS pixels; drawn at twice this. */
export const CARD_PORTRAIT = Object.freeze({ width: 96, height: 120 });
const SCALE = 2, SCRATCH = 640, ORIGIN = { x: SCRATCH / 2, y: SCRATCH * .62 };
const ENEMY_SPRITE_Y_OFFSET = -3;
/** The scale that fits a boss pose standing on the origin inside the scratch canvas. */
const bossFit = (w: number, h: number) => Math.min((SCRATCH * .9) / w, (ORIGIN.y * .9) / h);

export const CARD_FRAME_COLORS: Readonly<Record<CardRarity, { rim: string; glow: string }>> = {
  regular: { rim: "#b9c3cc", glow: "rgba(185, 195, 204, .18)" },
  elite: { rim: "#b48cff", glow: "rgba(180, 140, 255, .24)" },
  boss: { rim: "#f2c14e", glow: "rgba(242, 193, 78, .28)" },
};

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  let image = images.get(src);
  if (!image) {
    image = new Promise((resolve, reject) => {
      const element = new Image();
      element.decoding = "async";
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`Could not load ${src}`));
      element.src = src;
    });
    images.set(src, image);
  }
  return image;
}

async function drawEnemyPose(ctx: CanvasRenderingContext2D, source: EnemySpriteSource) {
  if ("src" in source) {
    const image = await loadImage(source.src);
    ctx.drawImage(image, -source.size / 2, -source.size, source.size, source.size);
    return;
  }
  const yOffset = ENEMY_SPRITE_Y_OFFSET + (source.visualOffsetY ?? 0);
  const animation = source.animation;
  if (animation) {
    const frame = animation.animations.idle.frames[0];
    const page = await loadImage(animation.pages[frame.page].src);
    ctx.save();
    if (animation.sourceFacingX === -1) ctx.scale(-1, 1);
    ctx.drawImage(page, frame.x, frame.y, frame.w, frame.h, animation.x, animation.y + yOffset, animation.w, animation.h);
    ctx.restore();
  }
  for (const layer of source.layers) {
    const image = await loadImage(layer.src);
    const drawable = layer.tint ? createTintedImageCanvas(image, layer.w, layer.h, layer.tint) ?? image : image;
    if (!layer.aimPivot) {
      ctx.drawImage(drawable, layer.x, layer.y + ENEMY_SPRITE_Y_OFFSET, layer.w, layer.h);
      continue;
    }
    ctx.save();
    ctx.translate(layer.aimPivot.x, layer.aimPivot.y + ENEMY_SPRITE_Y_OFFSET);
    ctx.rotate(-(layer.aimOffsetRadians ?? 0));
    ctx.drawImage(drawable, layer.x - layer.aimPivot.x, layer.y - layer.aimPivot.y, layer.w, layer.h);
    ctx.restore();
  }
}

/** A boss sheet cleaned the way the game cleans it at load: green backdrop out. */
async function bossSheet(boss: BossDefinition) {
  const image = await loadImage("sheet" in boss.art ? boss.art.sheet : boss.art.pages[0]);
  const chroma = "sheet" in boss.art ? boss.art.chroma : undefined;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context?.drawImage(image, 0, 0);
  if (!chroma || !context) return canvas;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  removeGreenPixels(pixels.data, chroma.greenThreshold, chroma.ratio);
  context.putImageData(pixels, 0, 0);
  return canvas;
}

type IdleAtlas = { pages: readonly { src: string }[]; animations: { idle: { frames: readonly { page: number; x: number; y: number; w: number; h: number }[] } } };
const BOSS_ATLASES: Partial<Record<BossKind, IdleAtlas>> = {
  tidewyrm: CARAPACE_ANGLER_ATLAS, ironhorn: IRONHORN_ATLAS, dreadreaper: DREADREAPER_ATLAS,
};

async function drawBossPose(ctx: CanvasRenderingContext2D, card: CardDefinition) {
  const boss = bossForMap(card.mapId);
  if (!boss) return;
  const atlas = BOSS_ATLASES[boss.kind];
  if (atlas) {
    const frame = atlas.animations.idle.frames[0];
    const page = await loadImage(atlas.pages[frame.page].src);
    const fit = bossFit(frame.w, frame.h);
    ctx.drawImage(page, frame.x, frame.y, frame.w, frame.h, -frame.w * fit / 2, -frame.h * fit, frame.w * fit, frame.h * fit);
    return;
  }
  if (boss.kind === "prismshell") {
    const { pages: [page], bounds } = PRISMSHELL_ATLAS;
    const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top, fit = bossFit(w, h);
    ctx.drawImage(await loadImage(page.src), bounds.left, bounds.top, w, h, -w * fit / 2, -h * fit, w * fit, h * fit);
    return;
  }
  // A strip of equal cells (BOSS_ART), idle first, with the game's own per-frame crop.
  const bossId = boss.kind.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase();
  const entry = (BOSS_ART as Record<string, { frames?: number; rows?: number }>)[bossId];
  const sheet = await bossSheet(boss);
  const columns = Math.max(1, entry?.frames ?? 1), rows = Math.max(1, entry?.rows ?? 1);
  const cellWidth = sheet.width / columns, cellHeight = sheet.height / rows;
  const fit = bossFit(cellWidth, cellHeight);
  drawBossSheetFrame(ctx, sheet, { bossId, frame: 0, cellWidth, cellHeight, columns, drawWidth: cellWidth * fit, drawHeight: cellHeight * fit, top: -cellHeight * fit });
}

/** A tree card's tree, as Timberwood draws that kind. */
async function drawTreePose(ctx: CanvasRenderingContext2D, kind: WoodTreeKind) {
  const frame = soulFrame(woodTreeFrame(kind));
  if (!frame) return;
  const fit = bossFit(frame.w, frame.h);
  ctx.drawImage(await loadImage(SOUL_ATLAS_SOURCE), frame.x, frame.y, frame.w, frame.h, -frame.ax * fit, -frame.ay * fit, frame.w * fit, frame.h * fit);
}

/** The smallest box around every pixel drawn. */
function drawnBounds(ctx: CanvasRenderingContext2D) {
  const { width, height } = ctx.canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] < 16) continue;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return right < 0 ? null : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function drawFrame(ctx: CanvasRenderingContext2D, rarity: CardRarity) {
  const w = CARD_PORTRAIT.width * SCALE, h = CARD_PORTRAIT.height * SCALE, colors = CARD_FRAME_COLORS[rarity];
  const glow = ctx.createRadialGradient(w / 2, h * .55, 4, w / 2, h * .55, w * .75);
  glow.addColorStop(0, colors.glow);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = "#141516";
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, 14);
  ctx.fill();
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.lineWidth = rarity === "boss" ? 6 : 4;
  ctx.strokeStyle = colors.rim;
  ctx.stroke();
}

const portraits = new Map<string, Promise<string>>();
/** Lighter than the card's own dark backing, so the shape still reads. */
const CARD_SHADOW_COLOR = "#43474b";

/** A card's portrait as an image source: its enemy's own sprite, standing, in a frame of its rarity. */
export function cardPortrait(cardId: string, shadow = false): Promise<string> {
  const key = shadow ? `${cardId}:shadow` : cardId;
  const cached = portraits.get(key);
  if (cached) return cached;
  const card = cardDefinition(cardId);
  const portrait = (async () => {
    if (!card || typeof document === "undefined") return "";
    const scratch = document.createElement("canvas");
    scratch.width = scratch.height = SCRATCH;
    const scratchContext = scratch.getContext("2d", { willReadFrequently: true });
    const canvas = document.createElement("canvas");
    canvas.width = CARD_PORTRAIT.width * SCALE;
    canvas.height = CARD_PORTRAIT.height * SCALE;
    const context = canvas.getContext("2d");
    if (!scratchContext || !context) return "";
    scratchContext.imageSmoothingEnabled = false;
    scratchContext.translate(ORIGIN.x, ORIGIN.y);
    try {
      if (card.tree) await drawTreePose(scratchContext, card.tree);
      else if (card.rarity === "boss" && !card.endless) await drawBossPose(scratchContext, card);
      else {
        // Endless's Wardens wear their map's art; their cards show the Dread Warden who stands in every Endless camp.
        const source = (ENEMY_SPRITE_LAYOUTS as Record<string, EnemySpriteSource>)[card.endless ? "Dread Warden" : card.enemy];
        if (source) await drawEnemyPose(scratchContext, source);
      }
    } catch {
      // Art that will not load leaves an empty frame; the card's name still says what it is.
    }
    if (shadow) {
      // A card not found yet shows only its enemy's shape.
      scratchContext.setTransform(1, 0, 0, 1, 0, 0);
      scratchContext.globalCompositeOperation = "source-in";
      scratchContext.fillStyle = CARD_SHADOW_COLOR;
      scratchContext.fillRect(0, 0, SCRATCH, SCRATCH);
    }
    drawFrame(context, card.rarity);
    const bounds = drawnBounds(scratchContext);
    if (bounds) {
      const pad = 14 * SCALE, room = { w: canvas.width - pad * 2, h: canvas.height - pad * 2 };
      const fit = Math.min(room.w / bounds.w, room.h / bounds.h, 4);
      const w = bounds.w * fit, h = bounds.h * fit;
      context.imageSmoothingEnabled = fit < 1;
      context.drawImage(scratch, bounds.x, bounds.y, bounds.w, bounds.h, (canvas.width - w) / 2, pad + room.h - h, w, h);
    }
    return canvas.toDataURL("image/png");
  })();
  portraits.set(key, portrait);
  return portrait;
}
