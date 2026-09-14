import { itemPresentation, type WorldSpritePresentation } from "../../game/item-presentation";
import type { PlayerAppearanceAssets } from "../../game/player-appearance";
import type { PlayerLayer } from "../../game/player-layer-alignment";
import type { Draft } from "./state";
import { sourceDefaultPresentation, vendorWeapon, weaponPresentation } from "./vendor-weapons";

export function baselineSummary(draft: Draft, selected: PlayerLayer, assets: PlayerAppearanceAssets) {
  if (selected === "eyes") return "Eyes are separate from the expansion head: centers 32 / 53.6px across, 27.4px down.";
  if (selected === "head") return "Expansion helmet template: 65 × 50px. Current game uses the approved 2px right adjustment.";
  const id = selected === "weapon" ? draft.outfit.rightHandItem : selected === "helmet" ? draft.outfit.headItem : selected === "chest" ? draft.outfit.chestItem : "";
  const vendor = vendorWeapon(id), world = vendor ? weaponPresentation(vendor) : itemPresentation(id)?.world;
  const sprite = assets.equipment[id]?.sprite;
  if (["body", "head", "backLeg", "frontLeg"].includes(selected)) return "Base body and legs use the game's original placement in both modes.";
  if (!world || world.kind !== "SPRITE") return "No artwork equipped for this layer.";
  if (!sprite?.naturalWidth) return "Loading artwork dimensions…";
  const describe = (value: WorldSpritePresentation) =>
    `${value.width ?? sprite.naturalWidth} × ${value.height ?? sprite.naturalHeight}px · ${value.top !== undefined ? "top " + value.top : "bottom " + value.bottom}`;
  const label = vendor && !vendor.gameItemId ? "Vendor placement" : "Current game";
  return `${label}: ${describe(world)}. Source defaults: ${describe(sourceDefaultPresentation(world))}.`;
}
