import { weaponKind } from "./equip-best";

export type EquipmentAppearanceInput = {
  equippedHead: string;
  equippedChest: string;
  equippedFeet: string;
  equippedRightHand: string;
  equippedLeftHand: string;
  cosmeticHead?: string;
  cosmeticChest?: string;
  cosmeticFeet?: string;
  cosmeticRightHand?: string;
  cosmeticLeftHand?: string;
};

export type EquipmentAppearance = {
  headItem: string;
  chestItem: string;
  feetItem: string;
  rightHandItem: string;
  leftHandItem: string;
};

/** Reserved cosmetic value meaning the matching stat equipment stays equipped but is not drawn. */
export const HIDDEN_COSMETIC_ITEM_ID = "__hidden_cosmetic__";

export function isHiddenCosmeticItem(itemId: unknown) {
  return itemId === HIDDEN_COSMETIC_ITEM_ID;
}

function resolvedSlotAppearance(cosmeticItem: string | undefined, equippedItem: string) {
  if (isHiddenCosmeticItem(cosmeticItem)) return "";
  return cosmeticItem || equippedItem;
}

/**
 * Cosmetics override appearance only; one cosmetic hand replaces both regular
 * hands. A hand look shows only on a weapon of its own kind (equip-best.ts
 * weaponKind), because the look is what moves: a sword's look on a bow would
 * swing while arrows flew, and a bow's on a sword would draw while it struck.
 * The weapon itself is drawn instead.
 */
export function resolveEquipmentAppearance(equipment: EquipmentAppearanceInput): EquipmentAppearance {
  const kind = weaponKind(equipment.equippedRightHand || equipment.equippedLeftHand);
  const fits = (look: string) => isHiddenCosmeticItem(look) || weaponKind(look) === kind;
  const rightLook = equipment.cosmeticRightHand || "", leftLook = equipment.cosmeticLeftHand || "";
  const cosmeticRightHand = rightLook && fits(rightLook) ? rightLook : "";
  const cosmeticLeftHand = cosmeticRightHand || !leftLook || !fits(leftLook) ? "" : leftLook;
  const hasCosmeticHand = Boolean(cosmeticRightHand || cosmeticLeftHand);
  return {
    headItem: resolvedSlotAppearance(equipment.cosmeticHead, equipment.equippedHead),
    // An empty chest stays empty here. The renderer draws the default body
    // over the bare torso, so "nothing" and "nothing equipped" look the same.
    chestItem: resolvedSlotAppearance(equipment.cosmeticChest, equipment.equippedChest),
    feetItem: resolvedSlotAppearance(equipment.cosmeticFeet, equipment.equippedFeet),
    rightHandItem: hasCosmeticHand ? resolvedSlotAppearance(cosmeticRightHand, "") : equipment.equippedRightHand,
    leftHandItem: hasCosmeticHand ? resolvedSlotAppearance(cosmeticLeftHand, "") : equipment.equippedLeftHand,
  };
}
