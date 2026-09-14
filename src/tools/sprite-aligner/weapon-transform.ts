import type { LayerAdjustment, LayerBounds } from "../../game/player-layer-alignment";

/** Change the grip without moving the already aligned artwork. */
export function withGrip(adjustment: LayerAdjustment, source: NonNullable<LayerBounds["source"]>, pivotX: number, pivotY: number): LayerAdjustment {
  const dx = (pivotX - (adjustment.pivotX ?? .5)) * source.width;
  const dy = (pivotY - (adjustment.pivotY ?? .5)) * source.height;
  const radians = (adjustment.angle ?? 0) * Math.PI / 180;
  const x = dx * adjustment.scale * (adjustment.flipX ? -1 : 1), y = dy * adjustment.scale;
  return { ...adjustment, pivotX, pivotY,
    x: adjustment.x - dx + x * Math.cos(radians) - y * Math.sin(radians),
    y: adjustment.y - dy + x * Math.sin(radians) + y * Math.cos(radians) };
}

export function gripAtPoint(bounds: LayerBounds, x: number, y: number) {
  const m = bounds.transform, source = bounds.source;
  if (!m || !source || !source.width || !source.height) return null;
  const determinant = m.a * m.d - m.b * m.c;
  if (Math.abs(determinant) < 1e-9) return null;
  const dx = x - m.e, dy = y - m.f;
  const localX = (m.d * dx - m.c * dy) / determinant;
  const localY = (-m.b * dx + m.a * dy) / determinant;
  return { x: Math.max(0, Math.min(1, (localX - source.x) / source.width)),
    y: Math.max(0, Math.min(1, (localY - source.y) / source.height)) };
}

/** Aim controls describe the actor's direction, so forward turns with them. */
export function previewAim(aim: string, facing: string) {
  if (aim === "none") return null;
  const angle = Number(aim) * Math.PI / 180;
  return facing === "left" ? Math.PI - angle : angle;
}
