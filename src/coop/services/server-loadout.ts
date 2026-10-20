import { fallbackWeapon, weaponKind, type WeaponKind } from "../../../shared/equip-best";
import { canonicalItemId, itemDefinition, isCosmeticOnlyItem } from "../../../shared/items";
import type { PlayerProgress, ProgressSave } from "./progress";

export const EQUIPPED_FIELDS = ["equippedHead", "equippedChest", "equippedFeet", "equippedRightHand", "equippedLeftHand"] as const;
export type EquippedField = typeof EQUIPPED_FIELDS[number];
type Loadout = Record<EquippedField, string>;

/** One slot the server changed by itself: what it holds now and what it held. */
export type ServerLoadoutChange = { field: EquippedField; itemId: string; previous: string };

const HAND_FIELDS: readonly EquippedField[] = ["equippedRightHand", "equippedLeftHand"];

/**
 * The equipment slots the server changed on its own between two readings of
 * this player's progress row: auto equip putting on new gear, or a slot
 * emptied (a destroyed weapon, a restored run). The bag follows them, so it
 * never shows gear the server does not have.
 *
 * A slot counts only when the local save still held what the server had
 * before: a slot the player changed here since is on its way, and their save
 * wins. Gear going on must be an item, not a look, in the slot it fits; an
 * empty slot is a real state, since the server keeps emptied hands empty.
 */
export function serverLoadoutChanges(
  previous: PlayerProgress | null,
  next: PlayerProgress,
  pending: ProgressSave | null,
): ServerLoadoutChange[] {
  if (!previous) return [];
  return EQUIPPED_FIELDS
    .filter(field => previous[field] !== next[field] && (!pending || pending[field] === previous[field]))
    .filter(field => !next[field] || puttingOn(field, next[field]))
    .map(field => ({ field, itemId: next[field], previous: previous[field] }));
}

/** Slots a save asked for that the row does not hold after it (save_player_progress left them off); `previous` is the ask. */
export function refusedLoadout(sent: ProgressSave, row: PlayerProgress): ServerLoadoutChange[] {
  return EQUIPPED_FIELDS
    .filter(field => (canonicalItemId(sent[field]) ?? sent[field] ?? "") !== (row[field] ?? ""))
    .map(field => ({ field, itemId: row[field] ?? "", previous: sent[field] }));
}

function puttingOn(field: EquippedField, itemId: string) {
  const slot = itemDefinition(itemId)?.slot;
  if (!slot || isCosmeticOnlyItem(itemId)) return false;
  return HAND_FIELDS.includes(field) ? slot === "HAND" : field === `equipped${slot[0]}${slot.slice(1).toLowerCase()}`;
}

/**
 * Puts the server's changes on a loadout the way the inventory would: a
 * weapon going into one hand leaves the other hand empty.
 */
export function applyServerLoadout<T extends Loadout>(loadout: T, changes: readonly ServerLoadoutChange[]): T {
  const next = { ...loadout };
  for (const { field, itemId } of changes) {
    if (HAND_FIELDS.includes(field)) for (const hand of HAND_FIELDS) next[hand] = "";
    next[field] = itemId;
  }
  return next;
}

/** A queued save carrying the server's changes, so it does not undo them. */
export function withServerLoadout(pending: ProgressSave, changes: readonly ServerLoadoutChange[]): ProgressSave {
  return applyServerLoadout(pending, changes);
}

/**
 * A loadout that can attack. Both hands blank (a blank saved hand, or a weapon
 * no longer owned) is filled the way the server reads that hand: the best
 * weapon owned of the kind the hand held (`kind`, read before the lost weapon
 * was cleared), else the starter stone. Returns the weapon put on, or "" when
 * a hand already held one.
 */
export function fillEmptyHand(loadout: Loadout, itemIds: readonly string[],
  kind: WeaponKind = weaponKind(loadout.equippedRightHand || loadout.equippedLeftHand)) {
  if (loadout.equippedRightHand || loadout.equippedLeftHand) return "";
  loadout.equippedLeftHand = "";
  loadout.equippedRightHand = fallbackWeapon(itemIds, kind);
  return loadout.equippedRightHand;
}
