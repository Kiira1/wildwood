import { MOONFEN_ARMOR, CLOUDSPIRE_BOW, DIAMOND_GALAXY_ARMOR } from "../../../shared/items";
import { ALPHA_TESTER_GIFT_ITEM } from "../../../shared/item-gifts";
import { mergeProgress } from "../../coop/services/progress";
import { describe, expect, it, vi } from "vitest";
import { createGameBootstrap } from "./game-bootstrap";
import { createProgressController } from "./progress-controller";
import type { PlayerProgress, ProgressSave } from "../../coop/services/progress";

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
  it("keeps max health in step when a refine of worn gear changes the health bonus and nothing else", () => {
    const state = createGameBootstrap();
    const saved = { ...savedProgress(), maxHp: 1_000 };
    let bonus = .5;
    const controller = createProgressController({
      player: state.player, inventory: state.inventory, bootsPickup: state.bootsPickup, legacyStorageKey: "unused-legacy-save",
      getSavedProgress: () => saved, saveRemoteProgress: vi.fn(), localIdentity: () => "guest-identity", lifetimeEnemyKills: () => 0,
      isDeveloper: () => false, getTotalKills: () => 0, setTotalKills: vi.fn(), researchVitalityRank: () => 0,
      healthMultiplierBonus: () => bonus, setAppliedVitalityRank: vi.fn(), renderInventory: vi.fn(), onLoaded: vi.fn(),
    });
    controller.load();
    controller.load();
    expect(state.player.maxHp).toBeCloseTo(1_500);
    state.player.hp = 750;
    // The armor's refine rises: its health bonus with it, and the save is the same.
    bonus = .625;
    controller.load();
    expect(state.player.maxHp).toBeCloseTo(1_625);
    expect(state.player.hp / state.player.maxHp).toBeCloseTo(.5);
  });

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
      healthMultiplierBonus: () => 0,
      setAppliedVitalityRank: vi.fn(),
      renderInventory,
      onLoaded: vi.fn(),
    });
    controller.load();

    saved = { ...saved, attackRate: 1.2, regen: 0.6, damage: 9, armor: 3, maxHp: 150, attackRange: 230 };
    state.player.attackRate = 1.56;
    state.player.regen = 0;
    controller.load();

    expect(state.player.attackRate).toBe(1.2);
    expect(state.player.regen).toBe(0.6);
    expect(state.player.damage).toBe(9);
    expect(state.player.armor).toBe(3);
    expect(state.player.baseMaxHp).toBe(150);
    expect(state.player.attackRange).toBe(230);

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

  it("keeps a worn look the server saved, through a new device, an update and a membership still loading", () => {
    const state = createGameBootstrap();
    // Worn in the row, owned through a membership this client has not heard back about (lentLooks null).
    let saved = { ...savedProgress(), cosmeticChest: DIAMOND_GALAXY_ARMOR, cosmeticItemsJson: "[]" };
    const saveRemoteProgress = vi.fn();
    const controller = createProgressController({
      player: state.player, inventory: state.inventory, bootsPickup: state.bootsPickup,
      legacyStorageKey: "unused", getSavedProgress: () => saved,
      saveRemoteProgress, localIdentity: () => "player", lifetimeEnemyKills: () => 0,
      isDeveloper: () => false, lentLooks: () => null, getTotalKills: () => 0, setTotalKills: vi.fn(),
      researchVitalityRank: () => 0, healthMultiplierBonus: () => 0,
      setAppliedVitalityRank: vi.fn(), renderInventory: vi.fn(), onLoaded: vi.fn(),
    });
    controller.load();
    expect(state.inventory.cosmeticChest).toBe(DIAMOND_GALAXY_ARMOR);
    // A later row (new loot changes the bag) reconciles ownership again; the look stays on.
    saved = { ...saved, inventoryJson: JSON.stringify([...state.inventory.itemIds, CLOUDSPIRE_BOW]), cloudspireUnlocked: true };
    controller.load();
    expect(state.inventory.cosmeticChest).toBe(DIAMOND_GALAXY_ARMOR);
  });

  it("repairs a bag after missed completion hydration and removes items held by upgrades", () => {
    const state = createGameBootstrap();
    let saved = { ...savedProgress(), cloudspireUnlocked: true, inventoryJson: JSON.stringify(["basic_paper_hat", "starter_stone", CLOUDSPIRE_BOW]) };
    const renderInventory = vi.fn();
    const controller = createProgressController({
      player: state.player, inventory: state.inventory, bootsPickup: state.bootsPickup,
      legacyStorageKey: "unused", getSavedProgress: () => saved,
      saveRemoteProgress: vi.fn(), localIdentity: () => "player", lifetimeEnemyKills: () => 0,
      isDeveloper: () => false, getTotalKills: () => 0, setTotalKills: vi.fn(),
      researchVitalityRank: () => 0, healthMultiplierBonus: () => 0,
      setAppliedVitalityRank: vi.fn(), renderInventory, onLoaded: vi.fn(),
    });
    controller.load();
    // An equip here is queued as a save, so the merged progress holds it.
    state.inventory.equippedRightHand = CLOUDSPIRE_BOW;
    const pending = { ...saved, equippedRightHand: CLOUDSPIRE_BOW, enemyKills: 0 };
    saved = mergeProgress({ ...saved, inventoryJson: JSON.stringify([...state.inventory.itemIds, MOONFEN_ARMOR]) }, pending);
    controller.load();
    expect(state.inventory.itemIds).toContain(MOONFEN_ARMOR);
    expect(state.inventory.equippedRightHand).toBe(CLOUDSPIRE_BOW);

    // No new completion event and even the same server snapshot must repair
    // a stale runtime bag after reconnect, without duplicating the reward.
    state.inventory.itemIds = state.inventory.itemIds.filter(item => item !== MOONFEN_ARMOR);
    renderInventory.mockClear();
    controller.load(); controller.load();
    expect(state.inventory.itemIds.filter(item => item === MOONFEN_ARMOR)).toHaveLength(1);
    expect(renderInventory).toHaveBeenCalledOnce();

    state.inventory.equippedChest = MOONFEN_ARMOR;
    saved = { ...saved, inventoryJson: pending.inventoryJson };
    controller.load();
    expect(state.inventory.itemIds).not.toContain(MOONFEN_ARMOR);
    expect(state.inventory.equippedChest).toBe("");
    expect(state.inventory.equippedRightHand).toBe(CLOUDSPIRE_BOW);

    // A rebalance can revoke map access without changing bag ownership; gear never locks, so it stays on.
    saved = { ...saved, cloudspireUnlocked: false };
    controller.load();
    expect(state.inventory.equippedRightHand).toBe(CLOUDSPIRE_BOW);
    expect(state.inventory.itemIds).toContain(CLOUDSPIRE_BOW);
  });

  function loaded(initial: Partial<PlayerProgress>) {
    const state = createGameBootstrap();
    let saved: PlayerProgress = { ...savedProgress(), ...initial };
    // A save is queued as the coop session queues it: the merged progress shows it.
    const saveRemoteProgress = vi.fn((save: ProgressSave) => { saved = mergeProgress(saved, save); });
    const controller = createProgressController({
      player: state.player, inventory: state.inventory, bootsPickup: state.bootsPickup,
      legacyStorageKey: "unused-legacy-save", getSavedProgress: () => saved, saveRemoteProgress,
      localIdentity: () => "guest-identity", lifetimeEnemyKills: () => 0, isDeveloper: () => false,
      getTotalKills: () => 0, setTotalKills: vi.fn(), researchVitalityRank: () => 0, healthMultiplierBonus: () => 0,
      setAppliedVitalityRank: vi.fn(), renderInventory: vi.fn(), onLoaded: vi.fn(),
    });
    controller.load();
    return { state, saveRemoteProgress, reload: (next: Partial<PlayerProgress>) => { saved = { ...saved, ...next }; controller.load(); } };
  }

  it("leaves hands the player emptied empty on login, and when loot changes the bag", () => {
    const empty = loaded({ inventoryJson: '["starter_stone","iron_bow"]', equippedRightHand: "", equippedLeftHand: "", desertUnlocked: true });
    expect(empty.state.inventory.equippedRightHand).toBe("");
    expect(empty.state.inventory.equippedLeftHand).toBe("");
    empty.reload({ inventoryJson: '["starter_stone","iron_bow","cloudspire_bow"]' });
    expect(empty.state.inventory.equippedRightHand).toBe("");
    expect(empty.state.inventory.itemIds).toEqual(expect.arrayContaining(["starter_stone", "iron_bow"]));
  });

  it("keeps an owned weapon from a map not reached in hand, and refills a hand whose weapon is gone", () => {
    const early = loaded({ inventoryJson: '["starter_stone","iron_bow"]', equippedRightHand: "iron_bow" });
    expect(early.state.inventory.equippedRightHand).toBe("iron_bow");
    const gone = loaded({ inventoryJson: '["starter_stone"]', equippedRightHand: "iron_bow" });
    expect(gone.state.inventory.equippedRightHand).toBe("starter_stone");
  });

  it("keeps the stone when the row drops it, and an empty hand in the row empties the hand", () => {
    const view = loaded({ inventoryJson: '["starter_stone","iron_bow"]', equippedRightHand: "starter_stone" });
    view.reload({ inventoryJson: '["iron_bow"]', equippedRightHand: "" });
    expect(view.state.inventory.itemIds).toContain("starter_stone");
    // Empty hands are a state the server keeps (Reflect runs); the bag shows it rather than a weapon the server lacks.
    expect(view.state.inventory.equippedRightHand).toBe("");
    // Losing a map leaves its weapon in hand: gear never locks.
    const relocked = loaded({ inventoryJson: '["starter_stone","iron_bow"]', equippedRightHand: "iron_bow", desertUnlocked: true });
    relocked.reload({ desertUnlocked: false });
    expect(relocked.state.inventory.equippedRightHand).toBe("iron_bow");
  });

  it("shows the server's hand after a reconnect instead of the weapon it held before", () => {
    // The bag showed a sword while the row held an empty hand, so kills trained Archery.
    const view = loaded({ inventoryJson: '["starter_stone","eternal_sword"]', equippedRightHand: "eternal_sword" });
    expect(view.state.inventory.equippedRightHand).toBe("eternal_sword");
    view.reload({ equippedRightHand: "" });
    expect(view.state.inventory.equippedRightHand).toBe("");
    view.reload({ equippedRightHand: "eternal_sword" });
    expect(view.state.inventory.equippedRightHand).toBe("eternal_sword");
  });

  it("saves the weapon it puts in a hand whose weapon left the bag", () => {
    const view = loaded({ inventoryJson: '["starter_stone","wooden_sword","eternal_sword"]', equippedRightHand: "eternal_sword" });
    view.saveRemoteProgress.mockClear();
    view.reload({ inventoryJson: '["starter_stone","wooden_sword"]' });
    expect(view.state.inventory.equippedRightHand).toBe("wooden_sword");
    expect(view.saveRemoteProgress).toHaveBeenCalledWith(expect.objectContaining({ equippedRightHand: "wooden_sword" }), true);
  });
});
