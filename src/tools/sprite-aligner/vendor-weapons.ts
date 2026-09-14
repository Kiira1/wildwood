import { itemPresentation, type WorldSpritePresentation } from "../../game/item-presentation";

export type VendorWeapon = { id: string; source: string; category: string; label: string; gameItemId?: string };
declare const __WILDSTAT_VENDOR_WEAPONS__: VendorWeapon[];
export const VENDOR_WEAPONS: VendorWeapon[] = typeof __WILDSTAT_VENDOR_WEAPONS__ === "undefined" ? [] : __WILDSTAT_VENDOR_WEAPONS__;
const byId = new Map(VENDOR_WEAPONS.map(weapon => [weapon.id, weapon]));
export const vendorWeapon = (id: string) => byId.get(id);

export function weaponPresentation(weapon: VendorWeapon, sourceDefaults = false): WorldSpritePresentation {
  const game = weapon.gameItemId ? itemPresentation(weapon.gameItemId)?.world : undefined;
  if (!sourceDefaults && game?.kind === "SPRITE") return { ...game, source: weapon.source };
  return { kind: "SPRITE", source: weapon.source, layer: "HAND", top: 116,
    handAction: weapon.category === "Bow" ? "BOW" : undefined,
    weaponCategory: !sourceDefaults && weapon.category === "Sword" ? "SWORD" : undefined };
}

export function sourceDefaultPresentation(world: WorldSpritePresentation): WorldSpritePresentation {
  return { kind: "SPRITE", source: world.source, layer: world.layer,
    ...(world.layer === "HAND" ? { top: 116, handAction: world.handAction } : { bottom: world.layer === "HEAD" ? 144 : 168 }) };
}
