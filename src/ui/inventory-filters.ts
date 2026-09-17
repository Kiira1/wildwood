import type { ItemSlot } from "../../shared/items";

export type InventoryFilter = ItemSlot | "ALL";

export function createInventoryFilters(onFilter: (filter: InventoryFilter) => void, onEquipBest: () => void) {
  const bar = document.createElement("div");
  bar.className = "inventory-bag-toolbar";
  const filters = document.createElement("div");
  filters.className = "inventory-filters";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Filter inventory");
  let active: InventoryFilter = "ALL";
  const buttons = new Map<InventoryFilter, HTMLButtonElement>();
  for (const [filter, label] of [["ALL", "All"], ["HAND", "Weapons"], ["CHEST", "Armor"], ["HEAD", "Helmets"], ["FEET", "Boots"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = "inventory-filter";
    button.setAttribute("aria-pressed", String(filter === active));
    button.addEventListener("click", () => {
      if (active === filter) return;
      active = filter;
      for (const [key, tab] of buttons) tab.setAttribute("aria-pressed", String(key === active));
      onFilter(filter);
    });
    buttons.set(filter, button);
    filters.append(button);
  }
  const equip = document.createElement("button");
  equip.type = "button";
  equip.className = "inventory-equip-best";
  equip.textContent = "Equip best";
  equip.addEventListener("click", onEquipBest);
  bar.append(filters, equip);
  return { bar, setCosmetics: (cosmetics: boolean) => { equip.hidden = cosmetics; } };
}
