import { itemStats } from "../../shared/items";
import { itemArtMarkup } from "../game/item-presentation";
import { formatEquipmentAmount } from "./equipment-stat-format";
import { appendItemTierLabel } from "./item-tier-label";
import { appendRefineBadge } from "./refine-badge";

/**
 * A bag tile's insides: the art, the tier over it, the stat values along the bottom and the ★N.
 * `plain` leaves out the tier and stats (cosmetics); `stats: false` leaves out the stats alone.
 */
export function appendBagTileContents(button: HTMLElement, itemId: string,
  options: { refine?: number; tier?: number; artRefine?: number; plain?: boolean; stats?: boolean } = {}) {
  const refine = options.refine ?? 0;
  const art = document.createElement("span");
  art.className = "inventory-item-art-wrap";
  art.innerHTML = itemArtMarkup(itemId, true, options.artRefine ?? refine);
  button.append(art);
  if (!options.plain) {
    appendItemTierLabel(button, itemId, "above");
    if (options.stats !== false) button.append(statValues(itemId, options.tier ?? 0, refine));
  }
  appendRefineBadge(button, refine);
}

/** Damage, Max Health and Regen as short coloured values. */
function statValues(itemId: string, tier: number, refine: number) {
  const bonuses = document.createElement("span");
  bonuses.className = "inventory-item-bonuses";
  for (const stat of itemStats(itemId, { tier, refine })) {
    const match = /^(DAMAGE|MAX HEALTH|REGEN) (\+[\d.]+)(%?)$/.exec(stat);
    if (!match) continue;
    const value = document.createElement("span");
    value.dataset.statKind = match[1] === "DAMAGE" ? "damage" : match[1] === "MAX HEALTH" ? "health" : "regen";
    value.textContent = `+${formatEquipmentAmount(Number(match[2]))}${match[3]}`;
    value.title = stat;
    value.setAttribute("aria-label", stat);
    bonuses.append(value);
  }
  return bonuses;
}
