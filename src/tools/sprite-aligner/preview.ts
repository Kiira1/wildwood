import { itemPresentation, type WorldSpritePresentation } from "../../game/item-presentation";
import { vendorWeapon, weaponPresentation, sourceDefaultPresentation } from "./vendor-weapons";
import { drawStartingPlayer, type PlayerAppearanceAssets } from "../../game/player-appearance";
import type { LayerBounds, PlayerLayer } from "../../game/player-layer-alignment";
import { alignment, identityAdjustment, type Draft } from "./state";
import { previewAim } from "./weapon-transform";
import { drawHeadOverlay } from "./head-overlay";

export type PreviewOptions = { draft: Draft; facing: string; pose: string; aim: string; time: number; zoom: number; guides: boolean; background: string; selected: PlayerLayer; referenceBasis?: string; helmetView?: string; vendorOverlay?: string; overlayOpacity?: number; redraw?: () => void };
export function renderPreview(canvas: HTMLCanvasElement, assets: PlayerAppearanceAssets, options: PreviewOptions, edited: boolean) {
  const ctx = canvas.getContext("2d")!;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = options.background === "light" ? "#dfe5de" : options.background === "dark" ? "#161c20" : "#31945b";
  ctx.fillRect(0, 0, width, height);
  const zoom = options.zoom;
  const ground = height * .75;
  if (options.guides) {
    ctx.strokeStyle = options.background === "light" ? "#0002" : "#ffffff20";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = width / 2 % (12 * zoom); x < width; x += 12 * zoom) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = ground % (12 * zoom); y < height; y += 12 * zoom) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
    ctx.strokeStyle = "#ffffff70";
    ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.moveTo(0, ground); ctx.lineTo(width, ground); ctx.stroke();
  }
  const bounds = new Map<PlayerLayer, LayerBounds>();
  ctx.save();
  ctx.scale(zoom, zoom);
  const sourceDefaults = (edited ? options.draft.basis : options.referenceBasis) === "source";
  const presentationOverrides: Record<string, WorldSpritePresentation> = {};
  for (const id of Object.values(options.draft.outfit)) {
    const vendor = vendorWeapon(id), world = itemPresentation(id)?.world;
    if (vendor) presentationOverrides[id] = weaponPresentation(vendor, sourceDefaults);
    else if (sourceDefaults && world?.kind === "SPRITE") presentationOverrides[id] = sourceDefaultPresentation(world);
  }
  drawStartingPlayer(ctx, assets, {
    presentationOverrides,
    helmetOpacity: edited ? options.helmetView === "hidden" ? 0 : options.helmetView === "ghost" ? .25 : 1 : 1,
    ...options.draft.outfit, leftHandItem: "", x: width / (2 * zoom), y: ground / zoom - 29,
    facing: options.facing === "left" ? Math.PI : 0,
    moving: options.pose === "walk", gameTime: options.time,
    throwClock: options.pose === "attack" ? Math.max(0, .42 - options.time % .9) : 0,
    combatFacing: previewAim(options.aim, options.facing),
    skinTone: options.draft.skinTone,
    alignment: edited ? alignment(options.draft) : sourceDefaults ? { head: identityAdjustment() } : undefined,
    onLayerBounds: edited ? (layer, rectangle) => {
      if (layer !== "helmet" || options.helmetView !== "hidden") bounds.set(layer, rectangle);
    } : undefined,
  });
  ctx.restore();
  if (edited && options.vendorOverlay) drawHeadOverlay(ctx, bounds.get("head"), options.vendorOverlay, options.overlayOpacity ?? .5, options.redraw ?? (() => {}));
  const selected = bounds.get(options.selected);
  if (edited && options.guides && selected) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = "#e4ffe7"; ctx.lineWidth = dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeRect(selected.x, selected.y, selected.width, selected.height);
    ctx.setLineDash([]);
    if (options.selected === "weapon" && selected.pivot) {
      const { x, y } = selected.pivot;
      ctx.strokeStyle = "#ffda76";
      ctx.beginPath(); ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 8 * dpr, y); ctx.lineTo(x + 8 * dpr, y);
      ctx.moveTo(x, y - 8 * dpr); ctx.lineTo(x, y + 8 * dpr); ctx.stroke();
    }
  }
  return bounds;
}

export function localDragDelta(bounds: LayerBounds, dx: number, dy: number) {
  const { a, b, c, d } = bounds.axes ?? { a: 1, b: 0, c: 0, d: 1 };
  const determinant = a * d - b * c;
  return { x: (d * dx - c * dy) / determinant, y: (-b * dx + a * dy) / determinant };
}
