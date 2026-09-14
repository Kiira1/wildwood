export const PLAYER_LAYERS = ["backLeg", "frontLeg", "body", "chest", "head", "eyes", "helmet", "weapon"] as const;
export type PlayerLayer = typeof PLAYER_LAYERS[number];
export type LayerAdjustment = {
  x: number; y: number; scale: number;
  angle?: number; flipX?: boolean; pivotX?: number; pivotY?: number; spacing?: number;
};
export type PlayerLayerAlignment = Partial<Record<PlayerLayer, LayerAdjustment>>;
type LayerMatrix = { a: number; b: number; c: number; d: number; e: number; f: number };
export type LayerBounds = {
  x: number; y: number; width: number; height: number;
  axes?: { a: number; b: number; c: number; d: number };
  transform?: LayerMatrix;
  source?: { x: number; y: number; width: number; height: number };
  pivot?: { x: number; y: number };
};

/** Optional editor transforms; gameplay uses the same draw path with identity transforms. */
export function drawAlignedPlayerLayer(
  ctx: CanvasRenderingContext2D, layer: PlayerLayer, bounds: LayerBounds,
  adjustment: LayerAdjustment | undefined, draw: () => void,
  onBounds?: (layer: PlayerLayer, bounds: LayerBounds) => void,
) {
  const axes = onBounds ? ctx.getTransform() : undefined;
  const cx = bounds.x + bounds.width * (adjustment?.pivotX ?? .5);
  const cy = bounds.y + bounds.height * (adjustment?.pivotY ?? .5);
  ctx.save();
  if (adjustment) {
    ctx.translate(cx + adjustment.x, cy + adjustment.y);
    if (adjustment.angle) ctx.rotate(adjustment.angle * Math.PI / 180);
    ctx.scale(adjustment.scale * (adjustment.flipX ? -1 : 1), adjustment.scale);
    ctx.translate(-cx, -cy);
  }
  if (onBounds) {
    const matrix = ctx.getTransform();
    const points = [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y],
      [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]]
      .map(([x, y]) => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f }));
    const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
    onBounds(layer, { x, y, axes, transform: matrix, source: bounds,
      pivot: { x: matrix.a * cx + matrix.c * cy + matrix.e, y: matrix.b * cx + matrix.d * cy + matrix.f },
      width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y });
  }
  draw();
  ctx.restore();
}
