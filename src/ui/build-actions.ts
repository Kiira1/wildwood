import { BUILD_GEAR_SLOTS, type BuildGear, type SavedBuild } from "../../shared/builds";
import { moveInventoryItem, type InventoryState } from "../game/inventory";

type Result = { ok: boolean; error?: string };
export type BuildPort = {
  builds?: () => readonly (SavedBuild | null)[];
  saveBuild?: (slot: number) => Promise<Result>;
  applyBuildCards?: (slot: number) => Promise<Result>;
};
export type BuildActions = ReturnType<typeof createBuildActions>;

const equippedIn = (inventory: InventoryState, slot: keyof BuildGear) =>
  slot === "HAND" ? inventory.equippedRightHand : slot === "HEAD" ? inventory.equippedHead : slot === "CHEST" ? inventory.equippedChest : inventory.equippedFeet;

/**
 * Saving and equipping Builds. Equipping puts each saved item on the ordinary way, map requirements included,
 * then the server moves the saved cards into them. Gear no longer held is left as it is and counted.
 */
export function createBuildActions(o: {
  coop: () => BuildPort | null | undefined;
  inventory: InventoryState;
  requirement: (itemId: string) => string | null;
  /** Speed, health and the save that follow any equipment change. */
  afterGearChange: () => void;
  blocked: () => string | null;
}) {
  return {
    builds: () => o.coop()?.builds?.() ?? [],
    save: async (slot: number): Promise<Result> => o.coop()?.saveBuild?.(slot) ?? { ok: false, error: "Not Connected" },
    async equip(slot: number): Promise<Result & { missingGear?: number }> {
      const reason = o.blocked();
      if (reason) return { ok: false, error: reason };
      const build = o.coop()?.builds?.()[slot];
      if (!build) return { ok: false, error: "Save this build first." };
      let changed = false, missingGear = 0;
      for (const slotName of BUILD_GEAR_SLOTS) {
        const itemId = build.gear[slotName];
        if (!itemId || equippedIn(o.inventory, slotName) === itemId) continue;
        if (o.requirement(itemId) || !moveInventoryItem(o.inventory, itemId, slotName === "HAND" ? "RIGHT_HAND" : slotName)) { missingGear += 1; continue; }
        changed = true;
      }
      if (changed) o.afterGearChange();
      const cards = await (o.coop()?.applyBuildCards?.(slot) ?? Promise.resolve({ ok: false, error: "Not Connected" }));
      return { ...cards, missingGear };
    },
  };
}
