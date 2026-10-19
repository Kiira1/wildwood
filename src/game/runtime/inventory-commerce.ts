import type { InventoryState } from "../inventory";
import { setInventoryItemQuantity } from "../inventory";
import { applyPlayerMaxHealthMultiplierBonus } from "./player-health";
import type { WeaponSkillRoll } from "../../../shared/weapon-skills";
import type { OreId } from "../../../shared/refine";

type Result = { ok: boolean; error?: string } | undefined;
type KeptCopy = { id: bigint; itemId: string; roll: WeaponSkillRoll };

/** Apply confirmed server ownership changes to the visible local loadout. */
export function createInventoryCommerceActions(options: {
  inventory: InventoryState;
  player: { speed: number; baseMaxHp: number; maxHp: number; hp: number };
  coop: () => {
    equipmentLocked?: (itemId: string, copyId?: bigint) => boolean;
    setEquipmentLocked?: (itemId: string, locked: boolean, copyId?: bigint) => Promise<Result>;
    destroyEquipment?: (itemId: string) => Promise<Result>;
    destroyOre?: (oreId: OreId, expectedCount: number) => Promise<Result>;
    convertItemToCosmetic?: (itemId: string) => Promise<Result>;
    equipmentCopies?: () => readonly KeptCopy[];
    destroyEquipmentCopy?: (itemId: string, copyId: bigint) => Promise<Result>;
    sellGradedItem?: (itemId: string, copyId: bigint) => Promise<Result>;
    selectEquipmentCopy?: (copyId: bigint) => Promise<Result>;
  } | null;
  healthMultiplierBonus: () => number;
  movementSpeed: () => number;
}) {
  const refreshStats = () => {
    options.player.speed = options.movementSpeed();
    applyPlayerMaxHealthMultiplierBonus(options.player, options.healthMultiplierBonus());
  };
  return {
    equipmentLocked: (itemId: string, copyId = 0n) => options.coop()?.equipmentLocked?.(itemId, copyId) ?? false,
    setEquipmentLocked: async (itemId: string, locked: boolean, copyId = 0n) => options.coop()?.setEquipmentLocked?.(itemId, locked, copyId),
    destroyOre: async (oreId: OreId, expectedCount: number) => options.coop()?.destroyOre?.(oreId, expectedCount),
    async destroyEquipment(itemId: string) {
      const result = await options.coop()?.destroyEquipment?.(itemId);
      if (result?.ok) {
        setInventoryItemQuantity(options.inventory, itemId, 0);
        refreshStats();
      }
      return result;
    },
    async convertItemToCosmetic(itemId: string) {
      const result = await options.coop()?.convertItemToCosmetic?.(itemId);
      if (result?.ok) {
        options.inventory.cosmeticItemIds = [...new Set([...(options.inventory.cosmeticItemIds ?? []), itemId])];
      }
      return result;
    },
    // Kept copies never leave the item's first copy without an owner, so these
    // change no local ownership: the copy rows and rolls arrive from the server.
    equipmentCopies: (): readonly KeptCopy[] => options.coop()?.equipmentCopies?.() ?? [],
    destroyEquipmentCopy: async (itemId: string, copyId: bigint) => options.coop()?.destroyEquipmentCopy?.(itemId, copyId),
    selectEquipmentCopy: async (copyId: bigint) => options.coop()?.selectEquipmentCopy?.(copyId),
    /** A sale of the last copy drops the item from the local bag, as a destroy does; with copies kept the server moves one up. */
    async sellGradedItem(itemId: string, copyId: bigint) {
      const coop = options.coop();
      const last = copyId === 0n && !(coop?.equipmentCopies?.() ?? []).some(copy => copy.itemId === itemId);
      const result = await coop?.sellGradedItem?.(itemId, copyId);
      if (result?.ok && last) {
        setInventoryItemQuantity(options.inventory, itemId, 0);
        refreshStats();
      }
      return result;
    },
  };
}
