import type { WorldSpritePresentation } from "../../item-presentation";
import { WEAPON_ALIGNMENT_DEFAULTS } from "../../equipment-alignment";
import { normalizeToolLevel } from "../../../../shared/tools";
import { PICKAXE_PRESENTATION } from "./pickaxe-sprite";

/**
 * The hatchet, held while chopping in place of the player's weapon, as the pickaxe is held while mining: not an item.
 * A real axe from the vendor's parts pack for each tool level (scripts/art/tool-axes.json), gripped where the wooden
 * sword is gripped, so it swings on the sword's swing.
 */
export const WOODCUTTING_HATCHET = "woodcutting_hatchet";

/** Every axe's art size, and where its haft is held. */
export const AXE_SIZE = Object.freeze({ width: 108, height: 85 });
export const AXE_GRIP = Object.freeze({ x: 25, y: 41 });
/** The wooden sword's art size, whose grip the sword alignment places. */
const SWORD_SIZE = { width: 118, height: 59 };

/** The sword's alignment moved to the axe's grip: the same hand spot, angle and swing. */
function axeAlignment() {
  const sword = WEAPON_ALIGNMENT_DEFAULTS.SWORD, pivotX = sword.pivotX ?? .5, pivotY = sword.pivotY ?? .5;
  // The sword's grip, across from the art's middle and down from its top.
  const gripX = SWORD_SIZE.width * (pivotX - .5) + sword.x, gripY = SWORD_SIZE.height * pivotY + sword.y;
  return { ...sword, pivotX: AXE_GRIP.x / AXE_SIZE.width, pivotY: AXE_GRIP.y / AXE_SIZE.height,
    x: gripX - (AXE_GRIP.x - AXE_SIZE.width / 2), y: gripY - AXE_GRIP.y };
}
export const HATCHET_PRESENTATION: WorldSpritePresentation = { ...PICKAXE_PRESENTATION, alignment: axeAlignment() };
export const HATCHET_OVERRIDES: Readonly<Record<string, WorldSpritePresentation>> = Object.freeze({ [WOODCUTTING_HATCHET]: HATCHET_PRESENTATION });

/** The axe for a hatchet level: hatchet-0 Worn to hatchet-10 Starshard. */
export const hatchetArtSource = (level: number) => `assets/wildstat/tools/hatchet-${normalizeToolLevel(level)}.webp`;
