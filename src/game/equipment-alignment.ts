import type { LayerAdjustment } from "./player-layer-alignment";
import type { WorldSpritePresentation } from "./item-presentation";

export type WeaponCategory = "SWORD";
// Promoted from the user's saved Sword 025 Brown (wooden sword) alignment.
export const WEAPON_ALIGNMENT_DEFAULTS: Record<WeaponCategory, Readonly<LayerAdjustment>> = {
  SWORD: { x: 38.07, y: -3.97, scale: 1, angle: -28, flipX: false,
    pivotX: 0.2120783942239344, pivotY: 0.5109876959261637 },
};
export function defaultWeaponAlignment(presentation?: WorldSpritePresentation): Readonly<LayerAdjustment> | undefined {
  return presentation?.alignment ?? (presentation?.weaponCategory ? WEAPON_ALIGNMENT_DEFAULTS[presentation.weaponCategory] : undefined);
}
