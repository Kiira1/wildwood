import { defaultWeaponAlignment } from "../../game/equipment-alignment";
import { DEFAULT_HEAD_ALIGNMENT } from "../../game/player-head-template";
import { vendorWeapon, weaponPresentation } from "./vendor-weapons";
import { ITEM_PRESENTATIONS, itemPresentation } from "../../game/item-presentation";
import { PLAYER_LAYERS, type PlayerLayer, type PlayerLayerAlignment, type LayerAdjustment } from "../../game/player-layer-alignment";
import { PLAYER_SKIN_TONES, DEFAULT_SKIN_TONE } from "../../../shared/player-skin-tones";

export const LAYER_NAMES: Record<PlayerLayer, string> = { backLeg: "Back leg", frontLeg: "Front leg", body: "Body", chest: "Chest armor", head: "Head shape", eyes: "Eyes", helmet: "Helmet", weapon: "Weapon" };
export const SLOT_LAYERS = { headItem: "HEAD", chestItem: "CHEST", feetItem: "LEGS", rightHandItem: "HAND" } as const;
export type Outfit = Record<keyof typeof SLOT_LAYERS, string>;
export type Draft = { format: "wildstat-character-alignment"; version: 1; outfit: Outfit; skinTone: number; basis?: "game" | "source"; adjustments: Record<string, LayerAdjustment> };
export const freshDraft = (): Draft => ({ format: "wildstat-character-alignment", version: 1,
  outfit: { headItem: "basic_paper_hat", chestItem: "", feetItem: "", rightHandItem: "starter_stone" }, skinTone: DEFAULT_SKIN_TONE, adjustments: {} });
export const identityAdjustment = (): LayerAdjustment => ({ x: 0, y: 0, scale: 1 });
export function adjustmentKey(draft: Draft, layer: PlayerLayer) {
  const item = layer === "helmet" || layer === "eyes" ? draft.outfit.headItem : layer === "chest" ? draft.outfit.chestItem
    : layer === "weapon" ? draft.outfit.rightHandItem : layer === "backLeg" || layer === "frontLeg" ? draft.outfit.feetItem : "";
  return layer + ":" + (item || "base") + (draft.basis === "source" ? ":source" : "");
}
function weaponBaseline(draft: Draft) {
  if (draft.basis === "source") return undefined;
  const vendor = vendorWeapon(draft.outfit.rightHandItem);
  const world = vendor ? weaponPresentation(vendor) : itemPresentation(draft.outfit.rightHandItem)?.world;
  return world?.kind === "SPRITE" ? defaultWeaponAlignment(world) : undefined;
}
export function defaultAdjustment(draft: Draft, layer: PlayerLayer): LayerAdjustment {
  if (layer === "head" && draft.basis !== "source") return { ...DEFAULT_HEAD_ALIGNMENT };
  return { ...(layer === "weapon" ? weaponBaseline(draft) ?? identityAdjustment() : identityAdjustment()) };
}
export function alignment(draft: Draft): PlayerLayerAlignment {
  const result = Object.fromEntries(PLAYER_LAYERS.map(layer => [layer, draft.adjustments[adjustmentKey(draft, layer)]]).filter(([, value]) => value));
  const baseline = weaponBaseline(draft);
  if (!result.weapon && baseline) result.weapon = { ...baseline };
  result.head ??= defaultAdjustment(draft, "head");
  return result;
}
export function parseDraft(value: unknown, isVendorWeapon = (id: string) => Boolean(vendorWeapon(id))): Draft {
  const draft = value as Draft;
  if (!draft || draft.format !== "wildstat-character-alignment" || draft.version !== 1 || !draft.outfit || !draft.adjustments) throw new Error("Choose an alignment JSON exported by this tool.");
  const result = freshDraft();
  if (draft.basis !== undefined && draft.basis !== "game" && draft.basis !== "source") throw new Error("Invalid starting alignment.");
  result.basis = draft.basis;
  for (const [slot, layer] of Object.entries(SLOT_LAYERS)) {
    const item = draft.outfit[slot as keyof Outfit];
    const world = ITEM_PRESENTATIONS[item as keyof typeof ITEM_PRESENTATIONS]?.world;
    if (item !== "" && !(slot === "rightHandItem" && isVendorWeapon(item)) && (!world || (world.kind === "LEGS" ? "LEGS" : world.layer) !== layer)) throw new Error("Unknown item in " + slot);
    result.outfit[slot as keyof Outfit] = item;
  }
  if (!Number.isInteger(draft.skinTone) || draft.skinTone < 0 || draft.skinTone >= PLAYER_SKIN_TONES.length) throw new Error("Invalid skin tone.");
  result.skinTone = draft.skinTone;
  if (Object.keys(draft.adjustments).length > 1000) throw new Error("Too many adjustments.");
  for (const [key, adjustment] of Object.entries(draft.adjustments)) {
    if (!PLAYER_LAYERS.some(layer => key.startsWith(layer + ":")) || !adjustment
      || ![adjustment.x, adjustment.y, adjustment.scale].every(Number.isFinite)
      || (adjustment.angle !== undefined && (!Number.isFinite(adjustment.angle) || Math.abs(adjustment.angle) > 180))
      || (adjustment.flipX !== undefined && typeof adjustment.flipX !== "boolean")
      || [adjustment.pivotX, adjustment.pivotY].some(value => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1))
      || (adjustment.spacing !== undefined && (!Number.isFinite(adjustment.spacing) || adjustment.spacing < .25 || adjustment.spacing > 2))
      || Math.abs(adjustment.x) > 1000 || Math.abs(adjustment.y) > 1000 || adjustment.scale < .25 || adjustment.scale > 2) throw new Error("Invalid layer adjustment.");
    result.adjustments[key] = { x: adjustment.x, y: adjustment.y, scale: adjustment.scale };
    for (const property of ["angle", "flipX", "pivotX", "pivotY", "spacing"] as const) {
      if (adjustment[property] !== undefined) Object.assign(result.adjustments[key], { [property]: adjustment[property] });
    }
  }
  return result;
}
