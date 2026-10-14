import { CARDS, type CardDefinition } from "../../shared/cards";
import { cardName } from "../../shared/card-text";
import { cardPortrait } from "./card-portrait";
import { formatCompactNumber } from "./number-format";

const RARITY_ORDER = { regular: 0, elite: 1, boss: 2 } as const;
const CARD_ORDER = new Map(CARDS.map((card, index) => [card.id, index]));
const byMapThenRarity = (a: CardDefinition, b: CardDefinition) =>
  a.tier - b.tier || RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || (CARD_ORDER.get(a.id) ?? 0) - (CARD_ORDER.get(b.id) ?? 0);

/** The Cards tab: every card the player holds, with its count, in map order. */
export function createCardsTab(options: {
  cards: () => Readonly<Record<string, number>>;
  onInspect: (cardId: string) => void;
}) {
  const element = document.createElement("section");
  element.className = "cards-tab";
  element.setAttribute("aria-label", "Cards");
  element.hidden = true;
  const note = document.createElement("p");
  note.className = "inventory-cosmetics-note cards-tab-note";
  note.textContent = "Cards drop rarely from enemies and bosses. Slot them into gear at the Smith.";
  const grid = document.createElement("div");
  grid.className = "inventory-items cards-tab-grid";
  const empty = document.createElement("p");
  empty.className = "cards-tab-empty";
  empty.textContent = "No cards yet.";
  element.append(note, grid, empty);
  let rendered = "";

  function tile(card: CardDefinition, count: number) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `inventory-item is-filled is-card is-${card.rarity}`;
    button.dataset.cardId = card.id;
    button.setAttribute("aria-label", `${cardName(card)}, ${count}. Tap to inspect.`);
    const art = document.createElement("span");
    art.className = "inventory-item-art-wrap";
    const image = document.createElement("span");
    image.className = "inventory-item-art card-tile-art";
    image.setAttribute("aria-hidden", "true");
    art.append(image);
    void cardPortrait(card.id).then(source => { if (source) image.style.backgroundImage = `url(${source})`; });
    const label = document.createElement("span");
    label.className = "item-tier-label is-above";
    label.textContent = card.enemy;
    const stack = document.createElement("span");
    stack.className = "inventory-stack-count";
    stack.textContent = count < 10_000 ? String(count) : formatCompactNumber(count);
    button.append(label, art, stack);
    button.addEventListener("click", () => options.onInspect(card.id));
    return button;
  }

  function render() {
    const held = options.cards();
    const state = JSON.stringify(held);
    if (state === rendered) return;
    rendered = state;
    const cards = CARDS.filter(card => (held[card.id] ?? 0) > 0).sort(byMapThenRarity);
    grid.replaceChildren(...cards.map(card => tile(card, held[card.id])));
    empty.hidden = cards.length > 0;
  }

  return {
    element,
    render,
    show(visible: boolean) {
      element.hidden = !visible;
      if (visible) render();
    },
  };
}
