import { equipComparisonPower } from "../../../shared/equip-best";
import type { InventoryState } from "../inventory";
import type { CoopAccess } from "./coop-access";
import { displayedPlayerPowerProgress } from "./render/player-identity-renderer";
import type { createResearchController } from "./research-controller";
import type { PlayerState } from "./types";

type Research = Pick<ReturnType<typeof createResearchController>, "ranks" | "criticalChance" | "criticalDamageMultiplier">;

/**
 * The local player's power with some equipment, as the HUD shows it, or with `compare`
 * the unrounded figure Equip Best ranks gear by, bow skills included.
 */
export function createDisplayedPower(deps: {
  coop: CoopAccess;
  player: PlayerState;
  research: () => Research;
  soulCritDamage: () => number;
}) {
  const { coop, player } = deps;
  return function powerForEquipment(equipment: InventoryState, compare = false) {
    const research = deps.research();
    const power = equipComparisonPower(
      displayedPlayerPowerProgress({
        maxHp: player.baseMaxHp,
        damage: player.damage,
        attackRate: player.attackRate,
        armor: player.armor,
        regen: player.regen,
        critChance: research.criticalChance(),
        critMultiplier: research.criticalDamageMultiplier(deps.soulCritDamage()),
      }, {
        equippedHead: equipment.equippedHead,
        equippedChest: equipment.equippedChest,
        equippedFeet: equipment.equippedFeet,
        equippedRightHand: equipment.equippedRightHand,
        equippedLeftHand: equipment.equippedLeftHand,
        ...(compare ? {} : { activeCards: coop.client?.activeCardIds?.() }),
      }),
      research.ranks(),
      coop.itemLevel,
      compare ? coop.weaponSkills : undefined,
    );
    return compare ? power : Math.round(power);
  };
}
