import { cardDefinition } from "../../shared/cards";
import { cardName } from "../../shared/card-text";
import { CARD_FRAME_COLORS, cardPortrait } from "./card-portrait";
import { cardFoundPopupsEnabled } from "./card-found-setting";
import { createCardFoundOverlay, type CardFound } from "./card-found-overlay";
import type { CardCopy } from "./stat-reward-toast";

type CardDropListener = (drop: { cardIds: readonly string[] }) => void;
/** Optional, so a coop bundle without cards simply never announces one. */
type CardDropSource = { setOnCardDrop?: (listener: CardDropListener | null) => void; cards?: () => Readonly<Record<string, number>> };

/**
 * A card found for the first time gets its own moment on screen (card-found-overlay.ts), in the order found; another
 * copy of one already owned is a small line in the pickup log, in its rarity's colour, with how many are owned now.
 */
export function watchCardDrops(coop: CardDropSource | null | undefined, options: {
  show?: (found: CardFound) => void;
  /** The pickup log's line (as a stat reward shows). Without it every find gets the moment. */
  duplicate?: (copy: CardCopy) => void;
  /** After the rest of this update has landed: the find and the new counts arrive together, in either order. */
  settle?: (done: () => void) => void;
} = {}) {
  let announce = options.show;
  let queue = Promise.resolve();
  const settle = options.settle ?? (done => { setTimeout(done, 0); });
  coop?.setOnCardDrop?.(({ cardIds }) => {
    // Switched off, a find goes straight to the Cards tab with no popup.
    if (!cardFoundPopupsEnabled()) return;
    const found = cardIds.filter(cardId => cardDefinition(cardId));
    if (!found.length) return;
    settle(() => {
      const owned = coop.cards?.() ?? {};
      const dropped = new Map<string, number>();
      for (const cardId of found) dropped.set(cardId, (dropped.get(cardId) ?? 0) + 1);
      // New: every copy owned now came in this find. Its first copy gets the moment; any more are lines.
      const fresh = new Set([...dropped].filter(([cardId, count]) => (owned[cardId] ?? 0) <= count).map(([cardId]) => cardId));
      for (const cardId of found) {
        const card = cardDefinition(cardId)!;
        if (fresh.delete(cardId) || !options.duplicate) {
          announce ??= createCardFoundOverlay().show;
          queue = queue.then(() => cardPortrait(cardId)).then(artSource => announce!({ cardId, artSource })).catch(() => undefined);
        } else {
          const copy = { name: cardName(card), count: owned[cardId] ?? 0, color: CARD_FRAME_COLORS[card.rarity].rim };
          const duplicate = options.duplicate;
          void cardPortrait(cardId).then(artSource => duplicate({ ...copy, artSource: artSource ?? "" }), () => duplicate({ ...copy, artSource: "" }));
        }
      }
    });
  });
}
