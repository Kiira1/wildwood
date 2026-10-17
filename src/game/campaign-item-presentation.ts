import { CAMPAIGN_ITEM_DEFINITIONS, type CampaignItemId } from "../../shared/campaign-equipment";
import type { ItemPresentation } from "./item-presentation";

/** A staff is held upright and casts (player-appearance.ts); its art is already the in-hand size (import-vendor-staffs.mjs). */
export const staffPresentation = (source: string): ItemPresentation => ({
  inventory: { source, equippedWidth: 22, equippedHeight: 42 },
  world: { kind: "SPRITE", source, layer: "HAND", top: STAFF_HELD_TOP, handAction: "CAST" },
  projectile: "BOLT",
});
/** Where an upright staff's top sits in the character's frame: its head clears the hat. */
export const STAFF_HELD_TOP = 64;

/** Vendor parts use the same anchors and shared alignment controls as existing gear. */
export const CAMPAIGN_ITEM_PRESENTATIONS = Object.fromEntries(
  Object.entries(CAMPAIGN_ITEM_DEFINITIONS).map(([id, item]): [string, ItemPresentation] => {
    const source = `assets/wildstat/player-parts/${id.replace(/_/g, "-")}.webp`;
    // A sword swings, held as the Wooden Sword is: every sword is the vendor's Character Parts Pack art at the same
    // size (scripts/art/import-vendor-swords.mjs), so all of them share its alignment.
    if (item.weapon?.mode === "MELEE") return [id, {
      inventory: { source, equippedWidth: 32, equippedHeight: 28 },
      world: { kind: "SPRITE", source, layer: "HAND", top: 116, handAction: "SWING", weaponCategory: "SWORD" },
    }];
    if (item.weapon?.projectile === "BOLT") return [id, staffPresentation(source)];
    if (item.slot === "HAND") return [id, {
      inventory: { source, equippedWidth: 44, equippedHeight: 34 },
      world: { kind: "SPRITE", source, layer: "HAND", width: 115, height: 63, top: 106, handAction: "BOW" },
      projectile: "ARROW",
    }];
    if (item.slot === "CHEST") return [id, {
      inventory: { source, equippedWidth: 34, equippedHeight: 31 },
      world: { kind: "SPRITE", source, layer: "CHEST", width: 76, height: 68, top: 100 },
    }];
    return [id, {
      inventory: { source, equippedWidth: 30, equippedHeight: 27 },
      world: { kind: "SPRITE", source, layer: "HEAD", bottom: 144 },
    }];
  }),
) as Record<CampaignItemId, ItemPresentation>;
