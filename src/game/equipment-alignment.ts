import type { LayerAdjustment } from "./player-layer-alignment";
import type { WorldSpritePresentation } from "./item-presentation";

export type WeaponCategory = "SWORD";
// Promoted from the user's exported Sword 020 Black grip/alignment.
export const WEAPON_ALIGNMENT_DEFAULTS: Record<WeaponCategory, Readonly<LayerAdjustment>> = {
  SWORD: { x: 61, y: -8, scale: 1, angle: -28, flipX: false,
    pivotX: 0.2120783942239344, pivotY: 0.5109876959261637 },
};
export function defaultWeaponAlignment(presentation?: WorldSpritePresentation): Readonly<LayerAdjustment> | undefined {
  return presentation?.alignment ?? (presentation?.weaponCategory ? WEAPON_ALIGNMENT_DEFAULTS[presentation.weaponCategory] : undefined);
}
