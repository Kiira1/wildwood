/**
 * The local player's refines (★N by item id, the first copy's: the one a slot holds), so the character is drawn in
 * its graded gear's refine looks. The game reads them from the coop client (claimCoopClient); until then all is +0.
 */
let read: (itemId: string) => number = () => 0;

export function setLocalItemRefineSource(source: (itemId: string) => number) {
  read = source;
}

export const localItemRefine = (itemId: string) => read(itemId);

/** Refines for a worn look: an equipped piece's own, and none for a cosmetic look shown over it. */
export function wornItemRefine(
  equipped: { equippedHead?: string; equippedChest?: string; equippedRightHand?: string; equippedLeftHand?: string },
  refine: (itemId: string) => number,
) {
  const worn = [equipped.equippedHead, equipped.equippedChest, equipped.equippedRightHand, equipped.equippedLeftHand];
  return (itemId: string) => (itemId && worn.includes(itemId) ? refine(itemId) : 0);
}
