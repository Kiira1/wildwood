import { ALPHA_TESTER_GIFT_ITEM } from "../../../shared/item-gifts";
import { mergeProgress } from "../../coop/services/progress";
import { describe, expect, it, vi } from "vitest";
import { createGameBootstrap } from "./game-bootstrap";
import { createProgressController } from "./progress-controller";
import type { PlayerProgress } from "../../coop/services/progress";

function savedProgress(): PlayerProgress {
  const { inventory } = createGameBootstrap();
  return {
    maxHp: 100,
    damage: 4,
    attackRate: 1.56,
    projectileSpeed: 390,
    projectileCount: 1,
    attackRange: 200,
    armor: 0,
    regen: 0,
    speed: 190,
    speedOverride: 0,
    bootsCollected: false,
    inventoryJson: JSON.stringify(inventory.itemIds),
    equippedHead: inventory.equippedHead,
    equippedChest: inventory.equippedChest,
    equippedFeet: inventory.equippedFeet,
    equippedRightHand: inventory.equippedRightHand,
    equippedLeftHand: inventory.equippedLeftHand,
    cosmeticHead: "",
    cosmeticChest: "",
    cosmeticFeet: "",
    cosmeticRightHand: "",
    cosmeticLeftHand: "",
    introComplete: true,
    desertUnlocked: false,
    snowlandsUnlocked: false,
    lavaUnlocked: false,
    infernalUnlocked: false,
    waterUnlocked: false,
    samuraiUnlocked: false,
    cloudspireUnlocked: false,
    moonfenUnlocked: false,
    crystalHollowsUnlocked: false, clockworkRuinsUnlocked: false, duskfallOrchardUnlocked: false, neonBastionUnlocked: false, verdantCatacombsUnlocked: false, ionCitadelUnlocked: false,
    bowCount: 0,
    woodenArmorCount: 0,
  };
}

describe("loaded progress reconciliation", () => {
  it("reconciles stat rewards and claimed gift ownership after initial load without replacing equipment", () => {
    const state = createGameBootstrap();
    let saved = savedProgress();
    const renderInventory = vi.fn();
    const controller = createProgressController({
      player: state.player,
      inventory: state.inventory,
      bootsPickup: state.bootsPickup,
      legacyStorageKey: "unused-legacy-save",
      getSavedProgress: () => saved,
      saveRemoteProgress: vi.fn(),
      localIdentity: () => "guest-identity",
      lifetimeEnemyKills: () => 0,
      isDeveloper: () => false,
      getTotalKills: () => 0,
      setTotalKills: vi.fn(),
      researchVitalityRank: () => 0,
      healthMultiplier: () => 1,
      setAppliedVitalityRank: vi.fn(),
      renderInventory,
      onLoaded: vi.fn(),
    });
    controller.load();

    saved = { ...saved, attackRate: 1.2, regen: 0.6 };
    state.player.attackRate = 1.56;
    state.player.regen = 0;
    controller.load();

    expect(state.player.attackRate).toBe(1.2);
    expect(state.player.regen).toBe(0.6);

    // An already-running claimant receives server ownership while an earlier
    // local save still contains the inventory from before the gift was claimed.
    const pending = { ...saved, enemyKills: 0 };
    const headBefore = state.inventory.equippedHead;
    const baseItems = [...state.inventory.itemIds];
    saved = mergeProgress({ ...saved, inventoryJson: JSON.stringify([...baseItems, ALPHA_TESTER_GIFT_ITEM]) }, pending);
    renderInventory.mockClear();
    controller.load(); controller.load();
    expect(state.inventory.itemIds.filter(item => item === ALPHA_TESTER_GIFT_ITEM)).toHaveLength(1);
    expect(state.inventory.equippedHead).toBe(headBefore);
    expect(state.inventory.itemIds).toEqual([...baseItems, ALPHA_TESTER_GIFT_ITEM]);
    expect(renderInventory).toHaveBeenCalledOnce();
  });
});
