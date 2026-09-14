import type { PlayerAppearanceAssets } from "../../game/player-appearance";
import { VENDOR_WEAPONS, vendorWeapon } from "./vendor-weapons";

export function createWeaponPicker(assets: PlayerAppearanceAssets, redraw: () => void) {
  const choices = document.getElementById("rightHandItem") as HTMLSelectElement;
  const collection = document.getElementById("weaponCollection") as HTMLSelectElement;
  const previous = document.getElementById("previousWeapon") as HTMLButtonElement;
  const next = document.getElementById("nextWeapon") as HTMLButtonElement;
  const gameChoices = [...choices.options].map(option => ({ label: option.text, id: option.value }));
  for (const category of new Set(VENDOR_WEAPONS.map(weapon => weapon.category))) {
    collection.add(new Option("Expansion · " + category, category));
  }
  function populate(category: string) {
    choices.replaceChildren();
    const items = category === "game" ? gameChoices : VENDOR_WEAPONS.filter(weapon => weapon.category === category);
    for (const item of items) choices.add(new Option(item.label, item.id));
  }
  collection.addEventListener("change", () => { populate(collection.value); choices.dispatchEvent(new Event("change")); });
  function step(delta: number) {
    choices.selectedIndex = Math.max(0, Math.min(choices.options.length - 1, choices.selectedIndex + delta));
    choices.dispatchEvent(new Event("change"));
  }
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  return (id: string) => {
    const vendor = vendorWeapon(id), category = vendor?.category ?? "game";
    if (collection.value !== category) { collection.value = category; populate(category); }
    choices.value = id;
    previous.disabled = choices.selectedIndex <= 0;
    next.disabled = choices.selectedIndex >= choices.options.length - 1;
    if (vendor && !assets.equipment[id]) {
      const sprite = new Image();
      sprite.addEventListener("load", redraw, { once: true });
      sprite.addEventListener("error", redraw, { once: true });
      assets.equipment[id] = { sprite };
      sprite.src = vendor.source;
    }
    document.getElementById("weaponLibraryStatus")!.textContent = vendor
      ? vendor.gameItemId ? "Used in game · current alignment available" : vendor.category === "Sword" ? "Vendor art · shared sword alignment" : "Vendor art · no saved in-game alignment"
      : VENDOR_WEAPONS.length + " expansion weapons available";
  };
}
