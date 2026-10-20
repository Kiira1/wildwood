import type { WeaponSchool } from "../../../shared/weapon-mastery";
import {
  createCardSellerRuntime, createHomeStationTouchHandler, createSchoolWindowRuntime, createSmithRuntime, createStarterChestRuntime,
} from "../../ui/game-ui-runtime";
import type { createGameElements } from "../../ui/game-elements";
import { bindHomeTeleportButton } from "../../ui/home-teleport-button";
import type { createInventoryController } from "../../ui/inventory-controller";
import { createOxShopRuntime } from "../../ui/ox-shop-controller";
import { createUpgradeBenchController } from "../../ui/upgrade-bench-controller";
import { TUTORIAL_FOREST_MAP_ID, UPGRADE_BENCH_POSITION, type MapId } from "../world";
import type { CoopAccess } from "./coop-access";
import type { createGameBootstrap } from "./game-bootstrap";
import type { PlayerState } from "./types";

export type TownRuntimeDeps = {
  coop: CoopAccess;
  e: ReturnType<typeof createGameElements>;
  player: PlayerState;
  inventory: ReturnType<typeof createGameBootstrap>["inventory"];
  currentMapId: () => MapId;
  inTutorial: () => boolean;
  isMapTransitioning: () => boolean;
  teleportHome: () => Promise<boolean>;
  clearInput: () => void;
  renderInventory: () => void;
  equip: ReturnType<typeof createInventoryController>["equip"];
  showMessage: (text: string, color?: string) => void;
  techTree: { open: () => void; close: () => void };
  quests: { board: { open: () => void; close: () => void }; refreshAtHome: () => void };
  /** Closes every window that competes with the bench before it opens. */
  beforeBenchOpen: () => void;
  onUpgradeFinished: Parameters<typeof createUpgradeBenchController>[1]["onUpgradeFinished"];
  /** Reapplies speed and max health after the bench changed what is equipped. */
  applyEquipmentStats: () => void;
  saveProgress: (immediate?: boolean) => void;
};

/**
 * The Town's stations (Ox's shop, the Smith and its slot upgrades, the Card Seller, the schools) and the forest's Starter Chest.
 * Walking up to a station opens it; the home button closes them all before it teleports.
 */
export function createTownRuntimes(deps: TownRuntimeDeps) {
  const { coop, e, player, inventory, clearInput, showMessage } = deps;
  const client = () => coop.client;
  const inTown = () => deps.currentMapId() === "town";

  bindHomeTeleportButton(e.techTreeBtn, {
    beforeTeleport: () => {
      deps.techTree.close();
      upgradeBench.close();
      deps.quests.board.close();
      oxShop.close();
      smith.close();
      cardSeller.close();
      schools.close();
    },
    teleport: () => deps.inTutorial() ? Promise.resolve(false) : deps.teleportHome(),
    showFailure: failed => showMessage(failed ? "TELEPORT FAILED · TRY AGAIN" : "TELEPORT UNAVAILABLE", "#ffbc91"),
    showBlocked: text => showMessage(text, "#ffbc91"),
  });

  const oxShop = createOxShopRuntime({ coop: client, inventory, renderInventory: deps.renderInventory, showMessage, clearInput, inTown });
  const smith = createSmithRuntime({ coop: client, inventory, showMessage, clearInput, inTown, equip: deps.equip, slots: () => upgradeBench });
  const cardSeller = createCardSellerRuntime({ coop: client, showMessage, clearInput, inTown });
  const schools = createSchoolWindowRuntime({ coop: client, clearInput, inTown });
  const starterChest = createStarterChestRuntime({
    coop: client, player, showMessage, clearInput,
    inForest: () => deps.currentMapId() === TUTORIAL_FOREST_MAP_ID && !deps.isMapTransitioning(),
  });

  const openAfterClearingInput = (open: () => void) => () => { clearInput(); open(); };
  const updateHomeStations = createHomeStationTouchHandler(
    () => inTown() && !deps.isMapTransitioning(), player,
    openAfterClearingInput(() => deps.techTree.open()),
    () => { upgradeBench.updateTouch(); deps.quests.refreshAtHome(); },
    openAfterClearingInput(() => deps.quests.board.open()),
    openAfterClearingInput(() => oxShop.open()),
    openAfterClearingInput(() => smith.open()),
    openAfterClearingInput(() => cardSeller.open()),
    (school: WeaponSchool) => { clearInput(); schools.open(school); },
  );

  const upgradeBench = createUpgradeBenchController({
    panel: e.upgradeBenchPanel,
    prompt: e.upgradeBenchPrompt,
    slot: e.upgradeBenchSlot,
    slotTwo: e.upgradeBenchSlotTwo,
    slotThree: e.upgradeBenchSlotThree,
    statGain: e.upgradeBenchStatGain,
    timer: e.upgradeBenchTimer,
    action: e.upgradeBenchAction,
    speedUp: e.upgradeBenchSpeedUp,
    back: e.upgradeBenchBack,
    picker: e.upgradeBenchPicker,
    pickerItems: e.upgradeBenchPickerItems,
    closePicker: e.closeUpgradeBenchPickerBtn,
  }, {
    playerPosition: () => player,
    currentMapId: deps.currentMapId,
    benchMapId: "town",
    benchPosition: UPGRADE_BENCH_POSITION,
    activeUpgrades: () => coop.client?.activeItemUpgrades?.() ?? [],
    secondSlotUnlocked: () => coop.client?.secondUpgradeSlotUnlocked?.() ?? false,
    thirdSlotUnlocked: () => coop.client?.thirdUpgradeSlotUnlocked?.() ?? false,
    gemBalance: coop.gemBalance,
    upgradeLevel: itemId => coop.client?.itemUpgradeLevel?.(itemId) ?? 0,
    refineLevel: itemId => coop.client?.itemRefine?.(itemId) ?? 0,
    slotTier: track => coop.client?.slotUpgradeTier?.(track) ?? 0,
    slotUpgradeSpeedRank: () => coop.client?.research?.()?.slotUpgradeSpeed ?? 0,
    equippedIn: track => track === "HAND" ? (inventory.equippedRightHand || inventory.equippedLeftHand)
      : track === "HEAD" ? inventory.equippedHead : inventory.equippedChest,
    storage: localStorage,
    startUpgrade: async (slot, itemId, position) => coop.client?.startItemUpgrade?.(slot, itemId, position),
    localIdentity: coop.identity,
    cancelUpgrade: async slot => coop.client?.cancelItemUpgrade?.(slot),
    speedUpUpgrade: async slot => coop.client?.speedUpItemUpgradeWithGems?.(slot),
    unlockSecondSlot: async () => coop.client?.unlockSecondUpgradeSlot?.(),
    unlockThirdSlot: async () => coop.client?.unlockThirdUpgradeSlot?.(),
    beforeOpen: deps.beforeBenchOpen,
    host: { open: () => smith.open("upgrade"), close: () => smith.close() },
    setPaused: () => {},
    clearPlayerInput: clearInput,
    onInventoryChanged: () => {
      if (inventory.selectedItemId && !inventory.itemIds.includes(inventory.selectedItemId)) {
        inventory.selectedItemId = "";
        inventory.selectedItemLocation = "";
      }
      deps.applyEquipmentStats();
      deps.renderInventory();
      deps.saveProgress(true);
    },
    onUpgradeFinished: deps.onUpgradeFinished,
    showMessage,
  });

  return {
    oxShop, smith, cardSeller, schools, starterChest, upgradeBench,
    /** Opens a station the player walked up to, and moves the Starter Chest's prompt. */
    update() {
      updateHomeStations();
      starterChest.update();
    },
  };
}
