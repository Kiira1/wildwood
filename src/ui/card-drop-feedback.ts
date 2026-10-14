import { cardDefinition } from "../../shared/cards";
import { cardPortrait } from "./card-portrait";
import { createCardFoundOverlay, type CardFound } from "./card-found-overlay";

type CardDropListener = (drop: { cardIds: readonly string[] }) => void;
/** Optional, so a coop bundle without cards simply never announces one. */
type CardDropSource = { setOnCardDrop?: (listener: CardDropListener | null) => void };

/** Each card found gets its own moment on screen (card-found-overlay.ts), in the order found. */
export function watchCardDrops(coop: CardDropSource | null | undefined, show?: (found: CardFound) => void) {
  let announce = show;
  let queue = Promise.resolve();
  coop?.setOnCardDrop?.(({ cardIds }) => {
    announce ??= createCardFoundOverlay().show;
    for (const cardId of cardIds) {
      if (!cardDefinition(cardId)) continue;
      queue = queue.then(() => cardPortrait(cardId)).then(artSource => announce!({ cardId, artSource })).catch(() => undefined);
    }
  });
}
