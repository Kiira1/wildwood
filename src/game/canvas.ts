import { canvasRenderPixelRatio } from "./runtime/render/render-budget";
import { freezeCanvas, releaseFrozen, type FrozenImage } from "./runtime/render/frozen-canvas";
import { cameraZoomPreference } from "./runtime/render/camera-zoom-preference";
type TextSprite = {
  /** The text's canvas, then its frozen bitmap. */
  image: FrozenImage;
  /** Device pixels per text pixel it was drawn at, and its size in device pixels. */
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  textWidth: number;
  ascent: number;
  padding: number;
  pixels: number;
};

/** A run of text in one colour; a label's runs sit side by side on one sprite. */
export type TextSegment = { text: string; color: string };

type TextSpriteMetrics = {
  width: number;
  actualBoundingBoxAscent?: number;
  actualBoundingBoxDescent?: number;
  fontBoundingBoxAscent?: number;
  fontBoundingBoxDescent?: number;
};

export function textSpriteLayout(metrics: TextSpriteMetrics, fontSize: number, strokeWidth: number | null) {
  const safeFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16;
  const positiveMetric = (value: number | undefined) => Number.isFinite(value) && value! > 0 ? value! : undefined;
  const nonNegativeMetric = (value: number | undefined) => Number.isFinite(value) && value! >= 0 ? value! : undefined;
  const measuredAscent = positiveMetric(metrics.actualBoundingBoxAscent)
    ?? positiveMetric(metrics.fontBoundingBoxAscent)
    ?? safeFontSize * .8;
  // Zero descent is valid for digits. Extra raster bleed protects glyphs with
  // unreliable descent metrics without moving centered number labels.
  const measuredDescent = nonNegativeMetric(metrics.actualBoundingBoxDescent)
    ?? nonNegativeMetric(metrics.fontBoundingBoxDescent)
    ?? safeFontSize * .2;
  const textWidth = Math.max(1, Math.ceil(Number.isFinite(metrics.width) ? metrics.width : 1));
  const ascent = Math.max(1, Math.ceil(measuredAscent));
  const descent = Math.max(0, Math.ceil(measuredDescent));
  const glyphBleed = Math.max(2, Math.ceil(safeFontSize * .2));
  const padding = Math.ceil((strokeWidth ?? 0) / 2) + glyphBleed;
  return {
    textWidth,
    ascent,
    descent,
    padding,
    logicalWidth: textWidth + padding * 2,
    logicalHeight: ascent + descent + padding * 2,
  };
}

/** Device pixels per text pixel within this of a sprite's own scale count as one to one. */
const SCALE_MATCH = .01;
type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

/**
 * Text is drawn from cached sprites, one sprite pixel to one screen pixel on whole pixels wherever the
 * sprite's scale is the drawing scale, so it is never resampled.
 */
export function createCanvasPrimitives(ctx: CanvasRenderingContext2D) {
  // Room for every label on a crowded screen: a wounded enemy's health numbers are a sprite each.
  const TEXT_CACHE_LIMIT = 512;
  const TEXT_CACHE_PIXEL_LIMIT = 4_000_000;
  const textSprites = new Map<string, TextSprite>();
  let cachedTextPixels = 0;

  function textSprite(text: string, fillColor: string, strokeWidth: number | null, scale: number, segments?: readonly TextSegment[]) {
    const font = ctx.font;
    const direction = ctx.direction;
    const key = `${scale}\u0000${font}\u0000${direction}\u0000${fillColor}\u0000${strokeWidth ?? "fill"}\u0000${text}`;
    const cached = textSprites.get(key);
    if (cached) {
      textSprites.delete(key);
      textSprites.set(key, cached);
      return cached;
    }

    const canvas = document.createElement("canvas");
    const target = canvas.getContext("2d");
    if (target) {
      // WebKit can resolve different font metrics for a document canvas and a
      // detached canvas. Measure and render with this same context.
      target.font = font;
      target.direction = direction;
    }
    const measure = (value: string) => target?.measureText(value) ?? ctx.measureText(value);
    const metrics = measure(text);
    // Runs are laid side by side at their own widths, as one canvas would draw them.
    const segmentWidths = segments?.map(segment => measure(segment.text).width);
    const runWidth = segmentWidths?.reduce((sum, width) => sum + width, 0);
    const fontSize = Number.parseFloat(font.match(/([\d.]+)px/)?.[1] ?? "16");
    const { textWidth, ascent, padding, logicalWidth, logicalHeight } = textSpriteLayout(
      runWidth === undefined ? metrics : { ...metrics, width: runWidth }, fontSize, strokeWidth);
    canvas.width = Math.ceil(logicalWidth * scale);
    canvas.height = Math.ceil(logicalHeight * scale);
    if (target) {
      target.setTransform(scale, 0, 0, scale, 0, 0);
      target.font = font;
      target.direction = direction;
      target.textAlign = "left";
      target.textBaseline = "alphabetic";
      target.lineJoin = "round";
      let x = padding;
      for (const [index, run] of (segments ?? [{ text, color: fillColor }]).entries()) {
        if (strokeWidth !== null) {
          target.lineWidth = strokeWidth;
          target.strokeStyle = "#000";
          target.strokeText(run.text, x, padding + ascent);
        }
        target.fillStyle = run.color;
        target.fillText(run.text, x, padding + ascent);
        x += segmentWidths?.[index] ?? 0;
      }
    }
    const sprite: TextSprite = {
      image: canvas, scale, pixelWidth: canvas.width, pixelHeight: canvas.height,
      logicalWidth, logicalHeight, textWidth, ascent, padding, pixels: canvas.width * canvas.height,
    };
    textSprites.set(key, sprite);
    // Most labels stay on screen for many frames, so even one-off numbers are worth a bitmap.
    freezeCanvas(canvas, bitmap => {
      if (textSprites.get(key) !== sprite) return false;
      sprite.image = bitmap;
      return true;
    });
    cachedTextPixels += sprite.pixels;
    while (textSprites.size > TEXT_CACHE_LIMIT || cachedTextPixels > TEXT_CACHE_PIXEL_LIMIT) {
      const oldestKey = textSprites.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = textSprites.get(oldestKey);
      textSprites.delete(oldestKey);
      if (oldest) { cachedTextPixels -= oldest.pixels; releaseFrozen(oldest.image); }
    }
    return sprite;
  }

  /** The sprite's top left for text drawn at (x, y) with the context's align and baseline, in text pixels. */
  function spriteOrigin(sprite: Pick<TextSprite, "padding" | "textWidth" | "logicalHeight" | "ascent">, x: number, y: number) {
    const direction = ctx.direction;
    const align = ctx.textAlign === "start"
      ? direction === "rtl" ? "right" : "left"
      : ctx.textAlign === "end"
        ? direction === "rtl" ? "left" : "right"
        : ctx.textAlign;
    const anchorX = align === "center"
      ? sprite.padding + sprite.textWidth / 2
      : align === "right"
        ? sprite.padding + sprite.textWidth
        : sprite.padding;
    const anchorY = ctx.textBaseline === "middle"
      ? sprite.logicalHeight / 2
      : ctx.textBaseline === "top" || ctx.textBaseline === "hanging"
        ? sprite.padding
        : ctx.textBaseline === "bottom" || ctx.textBaseline === "ideographic"
          ? sprite.logicalHeight - sprite.padding
          : sprite.padding + sprite.ascent;
    return { left: x - anchorX, top: y - anchorY };
  }

  /** The scale to rasterise at for a drawing scale: the plates' (pixel ratio times the player's zoom) when it is that, else the pixel ratio. */
  function rasterScale(drawScale: number, pixelRatio: number) {
    const plates = pixelRatio * cameraZoomPreference();
    return Math.abs(drawScale - plates) < SCALE_MATCH ? plates : pixelRatio;
  }

  /**
   * Draws the sprite under `m`, the target's device transform. At the sprite's own scale it is copied one
   * to one onto whole device pixels; otherwise it is scaled as before. Leaves `target` untransformed.
   */
  function blit(target: CanvasRenderingContext2D, m: Matrix, sprite: TextSprite, left: number, top: number) {
    if (m.b === 0 && m.c === 0 && Math.abs(m.a - sprite.scale) < SCALE_MATCH && Math.abs(m.d - sprite.scale) < SCALE_MATCH) {
      const x = Math.round(m.a * left + m.e), y = Math.round(m.d * top + m.f);
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.drawImage(sprite.image, x, y);
      return;
    }
    const width = sprite.pixelWidth / sprite.scale, height = sprite.pixelHeight / sprite.scale;
    target.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    const smoothing = target.imageSmoothingEnabled;
    target.imageSmoothingEnabled = true;
    target.drawImage(sprite.image, left, top, width, height);
    target.imageSmoothingEnabled = smoothing;
    target.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawText(text: string, x: number, y: number, fillColor: string, strokeWidth: number | null, segments?: readonly TextSegment[]) {
    const pixelRatio = canvasRenderPixelRatio(window.devicePixelRatio || 1);
    if (typeof ctx.getTransform !== "function") {
      const sprite = textSprite(text, fillColor, strokeWidth, pixelRatio, segments);
      const { left, top } = spriteOrigin(sprite, x, y);
      const smoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sprite.image, left, top, sprite.pixelWidth / pixelRatio, sprite.pixelHeight / pixelRatio);
      ctx.imageSmoothingEnabled = smoothing;
      return;
    }
    const m = ctx.getTransform();
    const sprite = textSprite(text, fillColor, strokeWidth, rasterScale(Math.hypot(m.a, m.b), pixelRatio), segments);
    const { left, top } = spriteOrigin(sprite, x, y);
    blit(ctx, m, sprite, left, top);
    ctx.setTransform(m);
  }

  function pixelCircle(x: number, y: number, radius: number) {
    const step = 4;
    const radiusSquared = radius * radius;
    for (let offsetY = -radius; offsetY <= radius; offsetY += step) {
      const halfWidth = Math.sqrt(Math.max(0, radiusSquared - offsetY * offsetY));
      ctx.fillRect(
        Math.floor(x - halfWidth),
        Math.floor(y + offsetY),
        Math.ceil(halfWidth * 2),
        step,
      );
    }
  }

  function roundRect(x: number, y: number, width: number, height: number, radius: number) {
    const corner = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + corner, y);
    ctx.arcTo(x + width, y, x + width, y + height, corner);
    ctx.arcTo(x + width, y + height, x, y + height, corner);
    ctx.arcTo(x, y + height, x, y, corner);
    ctx.arcTo(x, y, x + width, y, corner);
    ctx.closePath();
  }

  function outlinedWorldText(
    text: string,
    x: number,
    y: number,
    fillColor: string,
    strokeWidth = ctx.lineWidth,
  ) {
    drawText(text, x, y, fillColor, strokeWidth);
  }

  /** Outlined text in several colours, drawn and cached as one sprite, aligned as one piece of text. */
  function outlinedWorldSegments(segments: readonly TextSegment[], x: number, y: number, strokeWidth = ctx.lineWidth) {
    let text = "", colors = "";
    for (const segment of segments) {
      text += segment.text;
      colors += `${segment.color}\u0001${segment.text.length}\u0001`;
    }
    drawText(text, x, y, colors, strokeWidth, segments);
  }

  function fillWorldText(text: string, x: number, y: number) {
    if (typeof ctx.fillStyle !== "string") {
      ctx.fillText(text, x, y);
      return;
    }
    drawText(text, x, y, ctx.fillStyle, null);
  }

  return { outlinedWorldText, outlinedWorldSegments, fillWorldText, pixelCircle, roundRect };
}
