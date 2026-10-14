import { CARDS, type CardDefinition } from "../../shared/cards";
import { cardName, mapName } from "../../shared/card-text";
import { cardPortrait } from "./card-portrait";
import { formatCompactNumber } from "./number-format";

const RARITY_ORDER = { regular: 0, elite: 1, boss: 2 } as const;
const CARD_ORDER = new Map(CARDS.map((card, index) => [card.id, index]));
/** Map order, then regular, elite, boss. */
export const byMapThenRarity = (a: CardDefinition, b: CardDefinition) =>
  a.tier - b.tier || RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || (CARD_ORDER.get(a.id) ?? 0) - (CARD_ORDER.get(b.id) ?? 0);

/** One card as a bag-style tile: its enemy's name, its portrait and the count held. Not found yet, only its shadow. */
export function cardTile(card: CardDefinition, count: number, onPick: () => void, found = true) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `inventory-item is-filled is-card is-${card.rarity}${found ? "" : " is-unfound"}`;
  button.dataset.cardId = card.id;
  button.setAttribute("aria-label", found ? `${cardName(card)}, ${count}` : `${cardName(card)}, not found yet`);
  const art = document.createElement("span");
  art.className = "inventory-item-art-wrap";
  const image = document.createElement("span");
  image.className = "inventory-item-art card-tile-art";
  image.setAttribute("aria-hidden", "true");
  art.append(image);
  void cardPortrait(card.id, !found).then(source => { if (source) image.style.backgroundImage = `url(${source})`; });
  const label = document.createElement("span");
  label.className = "item-tier-label is-above";
  label.textContent = card.enemy;
  const stack = document.createElement("span");
  stack.className = "inventory-stack-count";
  stack.textContent = count < 10_000 ? String(count) : formatCompactNumber(count);
  button.append(label, art, ...(found ? [stack] : []));
  button.addEventListener("click", onPick);
  return button;
}

const NONE_SLOTTED: ReadonlySet<string> = new Set();

/** A zone's heading across the grid: its name and how many of its cards are found, between two fading lines. */
function zoneDivider(mapId: string, found: number, total: number) {
  const divider = document.createElement("div");
  divider.className = "cards-zone-divider";
  divider.setAttribute("role", "heading");
  divider.setAttribute("aria-level", "3");
  const name = document.createElement("span");
  name.className = "cards-zone-name";
  name.textContent = mapName(mapId);
  const count = document.createElement("span");
  count.className = "cards-zone-count";
  count.textContent = `${found} / ${total}`;
  divider.append(name, count);
  return divider;
}

/** The Cards tab: every card in map order, with the count held. A card held or slotted is found; the rest are shadows. */
export function createCardsTab(options: {
  cards: () => Readonly<Record<string, number>>;
  slotted?: () => ReadonlySet<string>;
  onInspect: (cardId: string, found: boolean) => void;
}) {
  const element = document.createElement("section");
  element.className = "cards-tab";
  element.setAttribute("aria-label", "Cards");
  element.hidden = true;
  const note = document.createElement("p");
  note.className = "inventory-cosmetics-note cards-tab-note";
  note.textContent = "Cards drop rarely from enemies and bosses. Slot them into gear at the Smith.";
  const count = document.createElement("span");
  count.className = "inventory-capacity cards-tab-count";
  const grid = document.createElement("div");
  grid.className = "inventory-items cards-tab-grid";
  element.append(note, count, grid);
  const ordered = [...CARDS].sort(byMapThenRarity);
  let rendered = "";

  function render() {
    const held = options.cards();
    const slotted = options.slotted?.() ?? NONE_SLOTTED;
    const state = JSON.stringify([held, [...slotted].sort()]);
    if (state === rendered) return;
    rendered = state;
    const found = (cardId: string) => (held[cardId] ?? 0) > 0 || slotted.has(cardId);
    count.textContent = `${ordered.filter(card => found(card.id)).length} / ${ordered.length} Found`;
    const children: HTMLElement[] = [];
    ordered.forEach((card, index) => {
      // Map order keeps each zone's cards together; a divider opens each zone.
      if (card.mapId !== ordered[index - 1]?.mapId) {
        const zone = ordered.filter(other => other.mapId === card.mapId);
        children.push(zoneDivider(card.mapId, zone.filter(other => found(other.id)).length, zone.length));
      }
      children.push(cardTile(card, held[card.id] ?? 0, () => options.onInspect(card.id, found(card.id)), found(card.id)));
    });
    grid.replaceChildren(...children);
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
