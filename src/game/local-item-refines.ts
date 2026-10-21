/**
 * The local player's refine looks (★N by item id), so the character is drawn in its graded gear's ★10/★20 art:
 * the first copy's refine (the one a slot holds), or the best an unlocked cosmetic kept (lookRefine).
 * The game reads them from the coop client (claimCoopClient); until then all is +0.
 */
let read: (itemId: string) => number = () => 0;

export function setLocalItemRefineSource(source: (itemId: string) => number) {
  read = source;
}

export const localItemRefine = (itemId: string) => read(itemId);

/** The refine an item is drawn at: its first copy's, or its cosmetic's kept refine (player_cosmetic_refine) when higher. */
export function lookRefine(
  itemRefine: (itemId: string) => number,
  cosmeticRefine: (itemId: string) => number,
) {
  return (itemId: string) => (itemId ? Math.max(itemRefine(itemId), cosmeticRefine(itemId)) : 0);
}
