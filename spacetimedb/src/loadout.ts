import { BASIC_PAPER_HAT, canonicalItemId, itemFitsEquipmentSlot } from "../../shared/items";
import { fallbackWeapon, type EquipLoadout, type WeaponKind } from "../../shared/equip-best";

/**
 * What save_player_progress will actually put on from a requested loadout,
 * given what the player owns. Auto equip checks the same rules through the
 * same function, so nothing goes on automatically that the player could not
 * put on by hand.
 *
 * A head item that is not owned falls back to the paper hat (an empty head
 * stays empty). Chest and feet must be owned. A hand must be owned and fit
 * the hand, and the right hand wins: the left is only kept when the right
 * is empty.
 */
export function allowedLoadout(requested: EquipLoadout, inventory: readonly string[]): EquipLoadout {
  const equippedHead = requested.equippedHead === ""
    ? ""
    : inventory.includes(requested.equippedHead) ? requested.equippedHead : BASIC_PAPER_HAT;
  const equippedChest = inventory.includes(requested.equippedChest) ? requested.equippedChest : "";
  const equippedFeet = inventory.includes(requested.equippedFeet) ? requested.equippedFeet : "";
  const requestedRightHand = canonicalItemId(requested.equippedRightHand);
  const requestedLeftHand = canonicalItemId(requested.equippedLeftHand);
  const equippedRightHand = requestedRightHand && inventory.includes(requestedRightHand) && itemFitsEquipmentSlot(requestedRightHand, "RIGHT_HAND")
    ? requestedRightHand
    : "";
  const equippedLeftHand = !equippedRightHand && requestedLeftHand && inventory.includes(requestedLeftHand) && itemFitsEquipmentSlot(requestedLeftHand, "LEFT_HAND")
    ? requestedLeftHand
    : "";
  return { equippedHead, equippedChest, equippedFeet, equippedRightHand, equippedLeftHand };
}

// The saved-hand helpers behind index.ts's equippedRightHandForProgress and
// equippedLeftHandForProgress, which decide what a saved loadout shows.

/**
 * What a blank or unowned right hand reads as when the left hand holds nothing
 * either: the best weapon owned of the kind the saved hand held (a blank one
 * reads as ranged), else the starter stone. Never "", so a saved hand never
 * leaves a player unable to attack. The client fills an empty hand the same way.
 */
export function blankHandWeapon(inventory: readonly string[], kind: WeaponKind = "RANGED") {
  return fallbackWeapon(inventory, kind);
}

export function canonicalSavedHand(progress: any, field: "equippedRightHand" | "equippedLeftHand") {
  const itemId = canonicalItemId(progress[field]);
  return itemId && itemFitsEquipmentSlot(itemId, field === "equippedRightHand" ? "RIGHT_HAND" : "LEFT_HAND")
    ? itemId
    : "";
}
