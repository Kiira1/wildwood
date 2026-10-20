import type { WeaponSchool } from "../../../shared/weapon-mastery";
import {
  createCardSellerRuntime, createHomeStationTouchHandler, createSchoolWindowRuntime, createSmithRuntime, createStarterChestRuntime,
} from "../../ui/game-ui-runtime";
import type { createGameElements } from "../../ui/game-elements";
import { bindTownTeleportButton } from "../../ui/town-teleport-button";
import type { createInventoryController } from "../../ui/inventory-controller";
import { createOxShopRuntime } from "../../ui/ox-shop-controller";
import { createSlotUpgradesController } from "../../ui/slot-upgrades-controller";
import { TUTORIAL_FOREST_MAP_ID, SLOT_UPGRADES_POSITION, type MapId } from "../world";
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
  /** Closes every window that competes with Slot Upgrades before it opens. */
  beforeUpgradesOpen: () => void;
  onUpgradeFinished: Parameters<typeof createSlotUpgradesController>[1]["onUpgradeFinished"];
  /** Reapplies speed and max health after Slot Upgrades changed what is equipped. */
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

  bindTownTeleportButton(e.townButton, {
    beforeTeleport: () => {
      deps.techTree.close();
      slotUpgrades.close();
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
  const smith = createSmithRuntime({ coop: client, inventory, showMessage, clearInput, inTown, equip: deps.equip, slots: () => slotUpgrades });
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
    () => { slotUpgrades.updateTouch(); deps.quests.refreshAtHome(); },
    openAfterClearingInput(() => deps.quests.board.open()),
    openAfterClearingInput(() => oxShop.open()),
    openAfterClearingInput(() => smith.open()),
    openAfterClearingInput(() => cardSeller.open()),
    (school: WeaponSchool) => { clearInput(); schools.open(school); },
  );

  const slotUpgrades = createSlotUpgradesController({
    panel: e.slotUpgradesPanel,
    prompt: e.slotUpgradesPrompt,
    queueOne: e.slotUpgradesQueueOne,
    queueTwo: e.slotUpgradesQueueTwo,
    queueThree: e.slotUpgradesQueueThree,
    statGain: e.slotUpgradesStatGain,
    timer: e.slotUpgradesTimer,
    action: e.slotUpgradesAction,
    speedUp: e.slotUpgradesSpeedUp,
    back: e.slotUpgradesBack,
    picker: e.slotUpgradesPicker,
    pickerItems: e.slotUpgradesPickerItems,
    closePicker: e.closeSlotUpgradesPickerBtn,
  }, {
    playerPosition: () => player,
    currentMapId: deps.currentMapId,
    stationMapId: "town",
    stationPosition: SLOT_UPGRADES_POSITION,
    activeUpgrades: () => coop.client?.activeItemUpgrades?.() ?? [],
    secondQueueUnlocked: () => coop.client?.secondUpgradeSlotUnlocked?.() ?? false,
    thirdQueueUnlocked: () => coop.client?.thirdUpgradeSlotUnlocked?.() ?? false,
    gemBalance: coop.gemBalance,
    upgradeLevel: itemId => coop.client?.itemUpgradeLevel?.(itemId) ?? 0,
    refineLevel: itemId => coop.client?.itemRefine?.(itemId) ?? 0,
    slotTier: slot => coop.client?.slotUpgradeTier?.(slot) ?? 0,
    slotUpgradeSpeedRank: () => coop.client?.research?.()?.slotUpgradeSpeed ?? 0,
    equippedIn: slot => slot === "HAND" ? (inventory.equippedRightHand || inventory.equippedLeftHand)
      : slot === "HEAD" ? inventory.equippedHead : inventory.equippedChest,
    storage: localStorage,
    startUpgrade: async (queue, itemId, position) => coop.client?.startItemUpgrade?.(queue, itemId, position),
    localIdentity: coop.identity,
    cancelUpgrade: async queue => coop.client?.cancelItemUpgrade?.(queue),
    speedUpUpgrade: async queue => coop.client?.speedUpItemUpgradeWithGems?.(queue),
    unlockSecondQueue: async () => coop.client?.unlockSecondUpgradeSlot?.(),
    unlockThirdQueue: async () => coop.client?.unlockThirdUpgradeSlot?.(),
    beforeOpen: deps.beforeUpgradesOpen,
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
    oxShop, smith, cardSeller, schools, starterChest, slotUpgrades,
    /** Opens a station the player walked up to, and moves the Starter Chest's prompt. */
    update() {
      updateHomeStations();
      starterChest.update();
    },
  };
}
