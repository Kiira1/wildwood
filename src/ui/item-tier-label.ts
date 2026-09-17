import { itemTier } from "../../shared/item-tier";

export function appendItemTierLabel(element: HTMLElement, itemId: string) {
  const tier = itemTier(itemId);
  if (!tier) return;
  const label = document.createElement("span");
  label.className = "item-tier-label";
  label.textContent = `Tier ${tier}`;
  element.append(label);
}
