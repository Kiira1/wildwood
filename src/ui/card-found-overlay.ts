import { cardDefinition, type CardRarity } from "../../shared/cards";
import { cardEffectText, cardName, cardOrigin } from "../../shared/card-text";
import { CARD_FRAME_COLORS } from "./card-portrait";

export type CardFound = { cardId: string; artSource: string };

const KICKERS: Readonly<Record<CardRarity, string>> = { regular: "Card Found", elite: "Elite Card Found", boss: "Boss Card Found" };
const SPARKS = 14;
/** A tap this soon after the card appears is a stray combat tap, not a dismissal. */
export const CARD_FOUND_TAP_GUARD_MS = 700;

/**
 * A card found takes the middle of the screen until tapped: light rays, a burst and sparks in its rarity's
 * colour, the card popping in with a shine, then its name and effects. The game keeps running behind it.
 * Cards found together wait their turn. Escape also closes it.
 */
export function createCardFoundOverlay(options: { root?: Document; now?: () => number } = {}) {
  const doc = options.root ?? document;
  const now = options.now ?? (() => performance.now());
  const overlay = doc.createElement("div");
  overlay.className = "card-found";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-labelledby", "cardFoundName");
  doc.body.append(overlay);
  const queue: CardFound[] = [];
  let showing = false;
  let readyAt = 0;

  const part = (tag: string, className: string, text?: string) => {
    const element = doc.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  function render(found: CardFound) {
    const card = cardDefinition(found.cardId)!;
    overlay.dataset.rarity = card.rarity;
    overlay.style.setProperty("--card-found-color", CARD_FRAME_COLORS[card.rarity].rim);
    const sparks = part("div", "card-found-sparks");
    for (let index = 0; index < SPARKS; index += 1) {
      const spark = doc.createElement("span");
      const angle = (index / SPARKS) * Math.PI * 2 + (index % 2) * .2;
      const distance = 110 + (index % 3) * 45;
      spark.style.setProperty("--spark-x", `${Math.round(Math.cos(angle) * distance)}px`);
      spark.style.setProperty("--spark-y", `${Math.round(Math.sin(angle) * distance)}px`);
      spark.style.animationDelay = `${(index % 4) * 40}ms`;
      sparks.append(spark);
    }
    const art = part("div", "card-found-art");
    const image = doc.createElement("img");
    image.alt = "";
    image.draggable = false;
    if (found.artSource) image.src = found.artSource;
    art.append(image, part("span", "card-found-shine"));
    const name = part("h2", "card-found-name", cardName(card));
    name.id = "cardFoundName";
    const effects = part("div", "card-found-effects");
    for (const effect of card.effects) {
      const line = part("span", "", cardEffectText(effect));
      line.dataset.statKind = effect.value < 0 ? "cost" : "card";
      effects.append(line);
    }
    const body = part("div", "card-found-body");
    body.append(part("p", "card-found-kicker", KICKERS[card.rarity]), art, name,
      part("p", "card-found-origin", cardOrigin(card)), effects, part("p", "card-found-hint", "Tap to Continue"));
    overlay.replaceChildren(part("div", "card-found-rays"), part("div", "card-found-burst"), sparks, body);
  }

  function next() {
    const found = queue.shift();
    if (!found) {
      showing = false;
      overlay.hidden = true;
      overlay.replaceChildren();
      return;
    }
    showing = true;
    readyAt = now() + CARD_FOUND_TAP_GUARD_MS;
    render(found);
    overlay.hidden = false;
  }

  function dismiss() {
    if (showing && now() >= readyAt) next();
  }

  overlay.addEventListener("click", dismiss);
  doc.addEventListener("keydown", (event) => {
    if (overlay.hidden || event.key !== "Escape") return;
    // Escape belongs to a text field that has focus.
    const focused = doc.activeElement;
    if (focused && /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName)) return;
    // One Escape closes one layer: the card, not the window beneath it too.
    event.stopImmediatePropagation();
    dismiss();
  }, true);

  return {
    show(found: CardFound) {
      if (!cardDefinition(found.cardId)) return;
      queue.push(found);
      if (!showing) next();
    },
    isOpen: () => showing,
  };
}
