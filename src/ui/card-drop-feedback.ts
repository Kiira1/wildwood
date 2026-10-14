import { cardDefinition } from "../../shared/cards";
import { cardEffectText, cardName } from "../../shared/card-text";
import { CARD_FRAME_COLORS, cardPortrait } from "./card-portrait";
import type { ItemDropRevealDetails } from "./item-drop-reveal";

type CardDropSource = { setOnCardDrop?: (callback: ((drop: { cardIds: readonly string[] }) => void) | null) => void };

/** A card found pops up the way a new item does: its portrait, its name and what it does, in the order found. */
export function watchCardDrops(coop: CardDropSource | null | undefined, show: (details: ItemDropRevealDetails) => void) {
  let queue = Promise.resolve();
  coop?.setOnCardDrop?.(({ cardIds }) => {
    for (const card of cardIds.map(cardDefinition)) {
      if (!card) continue;
      queue = queue.then(() => cardPortrait(card.id)).then(artSource => show({
        artSource, color: CARD_FRAME_COLORS[card.rarity].rim, name: cardName(card), stats: card.effects.map(effect => cardEffectText(effect)),
      })).catch(() => undefined);
    }
  });
}
