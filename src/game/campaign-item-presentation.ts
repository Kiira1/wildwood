import { CAMPAIGN_ITEM_DEFINITIONS, type CampaignItemId } from "../../shared/campaign-equipment";
import type { ItemPresentation } from "./item-presentation";

/** Vendor parts use the same anchors and shared alignment controls as existing gear. */
export const CAMPAIGN_ITEM_PRESENTATIONS = Object.fromEntries(
  Object.entries(CAMPAIGN_ITEM_DEFINITIONS).map(([id, item]): [string, ItemPresentation] => {
    const source = `assets/wildstat/player-parts/${id.replace(/_/g, "-")}.webp`;
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
