import { formatEquipmentStat } from "./equipment-stat-format";
import { appendItemTierLabel } from "./item-tier-label";
import { itemArtMarkup, itemHasGalaxyFinish, itemInventoryRotation, itemPresentation } from "../game/item-presentation";
import {
  itemDefinition,
  itemDisplayName,
  itemStats,
  normalizeItemUpgradeLevel,
} from "../../shared/items";
import { weaponSkillLines, type WeaponSkillRoll } from "../../shared/weapon-skills";
import { normalizeRefineLevel } from "../../shared/refine-multiplier";
import { refineStars } from "./refine-badge";
import { oreIconSource } from "./ore-icon";
import { oreDescription } from "../../shared/ore-bag";
import { REFINE_ORES, type OreId } from "../../shared/refine";
import { cardDefinition } from "../../shared/cards";
import { CARD_SLOT_NAMES, cardEffectText, cardName, cardOrigin } from "../../shared/card-text";
import { cardPortrait } from "./card-portrait";
import { itemSkillDetails } from "./item-skill-details";

export type ItemInspectionAction = {
  label: string;
  kind?: "PRIMARY" | "SECONDARY" | "DESTROY";
  disabled?: boolean;
  onActivate: () => void | Promise<void>;
};

export type OreInspectionRequest = { oreId: OreId; count: number; actions?: readonly ItemInspectionAction[] };

export type ItemInspectionRequest = {
  itemId: string;
  upgradeLevel?: number;
  /** The inspected copy's refine: a gold ★N after its name, and counted in its stats. */
  refine?: number;
  context?: string;
  description?: string;
  actions?: readonly ItemInspectionAction[];
  /** The item is this player's own, so its weapon skill roll (if any) is shown. */
  ownItem?: boolean;
  /** A kept copy's own roll, shown instead of the item's first copy's. */
  skills?: WeaponSkillRoll | null;
  /** This copy's card slots: each slotted card and what it does, then the open ones. */
  cardSlots?: { slots: number; cards: readonly string[] };
};

export type ItemInspectionController = ReturnType<typeof createItemInspectionController>;

type ItemInspectionElements = {
  panel: HTMLElement;
  title: HTMLElement;
  content: HTMLElement;
  back: HTMLButtonElement;
  /** Legacy bow-only getter; weaponSkills includes swords as well. */
  bowSkills?: (itemId: string) => WeaponSkillRoll | null | undefined;
  weaponSkills?: (itemId: string) => WeaponSkillRoll | null | undefined;
};

/** A weapon's stat lines followed by its skills, title case ("Arrow Storm 2.4%"). */
export function itemStatsWithWeaponSkills(itemId: string, level: number, roll: WeaponSkillRoll | null | undefined) {
  return [...itemStats(itemId, level), ...weaponSkillLines(itemId, roll)];
}

export function itemInspectionButtonLabel(label: string) {
  const trimmed = label.trim();
  if (!trimmed || trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_match, separator: string, letter: string) =>
    `${separator}${letter.toUpperCase()}`);
}

function section(title: string, count?: string) {
  const block = document.createElement("section");
  block.className = "item-inspection-section";
  const heading = document.createElement("h3");
  heading.className = "item-inspection-section-title";
  heading.textContent = title;
  if (count) {
    const tally = document.createElement("span");
    tally.textContent = count;
    heading.append(tally);
  }
  block.append(heading);
  return block;
}

/**
 * A weapon's skills: each one's chance, and a bar for where it sits between the worst and best roll this
 * weapon can have, with that range written under it, so a roll can be judged at a glance.
 */
function skillSection(itemId: string, roll: Parameters<typeof itemSkillDetails>[1]) {
  const skills = itemSkillDetails(itemId, roll);
  if (!skills.length) return null;
  const block = section("Skills");
  block.classList.add("item-inspection-skills");
  for (const skill of skills) {
    const row = document.createElement("div");
    row.className = "item-skill";
    const head = document.createElement("div");
    head.className = "item-skill-head";
    const name = document.createElement("strong");
    name.textContent = skill.label;
    const chance = document.createElement("span");
    chance.className = "item-skill-chance";
    chance.textContent = `${skill.percent.toFixed(1)}%`;
    head.append(name, chance);
    const bar = document.createElement("div");
    bar.className = "item-skill-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.round(8 + skill.quality * 92)}%`;
    bar.append(fill);
    const note = document.createElement("span");
    note.className = "item-skill-note";
    note.textContent = `${skill.quality >= 1 ? "Best Roll" : skill.quality <= 0 ? "Lowest Roll" : `${Math.round(skill.quality * 100)}% of Best`} · ${skill.min}–${skill.max}%`;
    row.append(head, bar, note);
    block.append(row);
  }
  return block;
}

/** A gear copy's card slots: each slotted card's portrait, name and effects, then the open slots. */
function cardSection({ slots, cards }: { slots: number; cards: readonly string[] }) {
  const block = section("Cards", `${Math.min(cards.length, slots)} / ${slots}`);
  block.classList.add("item-inspection-cards");
  for (let index = 0; index < slots; index++) {
    const card = cardDefinition(cards[index]);
    const row = document.createElement("div");
    row.className = card ? `item-card-slot is-${card.rarity}` : "item-card-slot is-empty";
    const art = document.createElement("span");
    art.className = "item-card-art";
    if (card) {
      const image = document.createElement("img");
      image.alt = "";
      image.draggable = false;
      void cardPortrait(card.id).then(source => { if (source) image.src = source; });
      art.append(image);
    }
    const text = document.createElement("div");
    text.className = "item-card-text";
    const name = document.createElement("strong");
    name.textContent = card ? cardName(card) : "Empty Slot";
    text.append(name);
    for (const line of card ? card.effects.map(effect => cardEffectText(effect)) : ["Slot a card at the Smith"]) {
      const effect = document.createElement("span");
      effect.textContent = line;
      text.append(effect);
    }
    row.append(art, text);
    block.append(row);
  }
  return block;
}

/** Standalone item window shared by inventory and future item-bearing screens. */
export function createItemInspectionController(elements: ItemInspectionElements) {
  let returnFocus: HTMLElement | null = null;
  const tools = elements.panel.querySelector<HTMLElement>(".item-inspection-tools")!;

  function close() {
    if (elements.panel.hidden) return;
    elements.panel.hidden = true;
    elements.content.replaceChildren();
    tools.replaceChildren();
    const focusTarget = returnFocus;
    returnFocus = null;
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
  }

  function open(request: ItemInspectionRequest) {
    const item = itemDefinition(request.itemId);
    if (!item) return false;
    const level = normalizeItemUpgradeLevel(request.upgradeLevel);
    const refine = normalizeRefineLevel(request.refine);
    if (elements.panel.hidden) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    elements.title.textContent = itemInspectionButtonLabel(itemDisplayName(item.id, level));
    // "Ion Bow ★7": the refine after the name, in gold.
    if (refine > 0) {
      const stars = document.createElement("span");
      stars.className = "refine-stars";
      stars.textContent = ` ${refineStars(refine)}`;
      elements.title.append(stars);
    }
    const icon = document.createElement("div");
    icon.className = "item-inspection-icon";
    const source = itemPresentation(item.id)?.inventory.source;
    // A finished piece is a masked CSS layer stack, not a plain image.
    if (source && !itemHasGalaxyFinish(item.id)) {
      const image = document.createElement("img");
      image.src = source;
      image.style.setProperty("--item-art-rotation", `${itemInventoryRotation(item.id)}deg`);
      image.alt = "";
      image.draggable = false;
      icon.append(image);
    } else {
      if (!source) icon.classList.add("has-fallback-art");
      icon.innerHTML = itemArtMarkup(item.id, false);
    }
    const preview = document.createElement("div");
    preview.className = "item-inspection-preview";
    preview.append(elements.title);
    const metadata = document.createElement("div");
    metadata.className = "item-inspection-metadata";
    appendItemTierLabel(metadata, item.id);
    if (metadata.childElementCount) preview.append(metadata);
    preview.append(icon);

    const copy = document.createElement("div");
    copy.className = "item-inspection-copy";
    if (request.context) {
      const context = document.createElement("div");
      context.className = "item-inspection-context";
      context.textContent = request.context;
      copy.append(context);
    }
    if (request.description) {
      const description = document.createElement("p");
      description.textContent = request.description;
      copy.append(description);
    }

    const stats = document.createElement("div");
    stats.className = "item-inspection-stats";
    for (const stat of itemStats(item.id, { tier: level, refine })) {
      const value = document.createElement("span");
      value.textContent = formatEquipmentStat(itemInspectionButtonLabel(stat));
      if (/^DAMAGE\b/.test(stat)) value.dataset.statKind = "damage";
      if (/^MAX HEALTH\b/.test(stat)) value.dataset.statKind = "health";
      if (/^REGEN\b/.test(stat)) value.dataset.statKind = "regen";
      if (/^ARMOR\b/.test(stat)) value.dataset.statKind = "armor";
      stats.append(value);
    }
    // A sword strikes up close, which its art alone does not say.
    if (item.weapon?.mode === "MELEE") {
      const value = document.createElement("span");
      value.textContent = "Melee";
      value.dataset.statKind = "melee";
      stats.append(value);
    }
    copy.append(stats);
    // Another player's weapon shows the roll its profile passes (player_worn_skill).
    const roll = request.skills !== undefined ? request.skills : (elements.weaponSkills ?? elements.bowSkills)?.(item.id);
    const skills = request.ownItem || request.skills ? skillSection(item.id, roll) : null;
    if (skills) copy.append(skills);
    if (request.cardSlots && request.cardSlots.slots > 0) copy.append(cardSection(request.cardSlots));

    const actionRow = renderActions(request.actions);

    const summary = document.createElement("div");
    summary.className = "item-inspection-summary";
    summary.append(preview, copy);
    elements.content.replaceChildren(summary, actionRow);
    elements.panel.hidden = false;
    elements.back.focus({ preventScroll: true });
    return true;
  }

  function renderActions(actions: readonly ItemInspectionAction[] = []) {
    const actionRow = document.createElement("div");
    actionRow.className = "item-inspection-actions";
    tools.replaceChildren();
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.kind === "SECONDARY" ? "item-inspection-action-secondary" : "item-inspection-action-primary";
      if (action.kind === "DESTROY") {
        button.className = "window-back-button item-inspection-destroy";
        button.setAttribute("aria-label", action.label);
        button.title = action.label;
        button.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
      } else button.textContent = itemInspectionButtonLabel(action.label);
      button.disabled = action.disabled === true;
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        button.disabled = true;
        try { await action.onActivate(); }
        finally { button.disabled = action.disabled === true; }
      });
      if (action.kind === "DESTROY") tools.append(button);
      else actionRow.append(button);
    }
    return actionRow;
  }

  /** An ore stack's window (shared/ore-bag.ts): its icon and name, how many are in the bag, what it refines and where it comes from. */
  function openOre(request: OreInspectionRequest) {
    if (elements.panel.hidden) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    elements.title.textContent = REFINE_ORES[request.oreId].name;
    const icon = document.createElement("div");
    icon.className = "item-inspection-icon";
    const source = oreIconSource(request.oreId);
    if (source) {
      const image = document.createElement("img");
      image.src = source;
      image.alt = "";
      image.draggable = false;
      icon.append(image);
    }
    const preview = document.createElement("div");
    preview.className = "item-inspection-preview";
    preview.append(elements.title, icon);
    const copy = document.createElement("div");
    copy.className = "item-inspection-copy";
    const context = document.createElement("div");
    context.className = "item-inspection-context";
    context.textContent = `${request.count.toLocaleString()} in your bag`;
    const { use, from } = oreDescription(request.oreId);
    const description = document.createElement("p");
    description.textContent = `${use} ${from}`;
    copy.append(context, description);
    const actionRow = renderActions(request.actions);
    const summary = document.createElement("div");
    summary.className = "item-inspection-summary";
    summary.append(preview, copy);
    elements.content.replaceChildren(summary, actionRow);
    elements.panel.hidden = false;
    elements.back.focus({ preventScroll: true });
    return true;
  }

  /** A card's window: its portrait, where it drops, how many are held, what gear it goes in and each effect. */
  /** `found` false is a card the player has never had: its shadow, and no count. */
  function openCard(request: { cardId: string; count: number; found?: boolean }) {
    const card = cardDefinition(request.cardId);
    if (!card) return false;
    if (elements.panel.hidden) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    elements.title.textContent = cardName(card);
    const icon = document.createElement("div");
    icon.className = "item-inspection-icon is-card";
    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    void cardPortrait(card.id, request.found === false).then(source => { if (source) image.src = source; });
    icon.append(image);
    const metadata = document.createElement("div");
    metadata.className = "item-inspection-metadata";
    const origin = document.createElement("span");
    origin.className = `card-origin is-${card.rarity}`;
    origin.textContent = cardOrigin(card);
    metadata.append(origin);
    const preview = document.createElement("div");
    preview.className = "item-inspection-preview";
    preview.append(elements.title, metadata, icon);
    const copy = document.createElement("div");
    copy.className = "item-inspection-copy";
    const context = document.createElement("div");
    context.className = "item-inspection-context";
    context.textContent = `Goes In: ${CARD_SLOT_NAMES[card.slot]} · ${request.found === false ? "Not Found Yet" : `${request.count.toLocaleString()} held`}`;
    const stats = document.createElement("div");
    stats.className = "item-inspection-stats";
    for (const effect of card.effects) {
      const value = document.createElement("span");
      value.textContent = cardEffectText(effect);
      value.dataset.statKind = effect.value < 0 ? "cost" : "card";
      stats.append(value);
    }
    const description = document.createElement("p");
    description.textContent = "Slot it into gear at the Smith.";
    copy.append(context, stats, description);
    tools.replaceChildren();
    const summary = document.createElement("div");
    summary.className = "item-inspection-summary";
    summary.append(preview, copy);
    elements.content.replaceChildren(summary);
    elements.panel.hidden = false;
    elements.back.focus({ preventScroll: true });
    return true;
  }

  elements.back.addEventListener("click", close);

  return {
    open,
    openOre,
    openCard,
    close,
    isOpen: () => !elements.panel.hidden,
  };
}
