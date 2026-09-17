import {
  type EquipmentSlot,
  type InventoryState,
} from "../game/inventory";
import { requiredElement } from "../game/runtime/dom";
import { canDestroyEquipment, itemDefinition, itemDisplayName } from "../../shared/items";
import { inventoryMoveActions, inventoryWeaponSlot, renderInventoryView, type InventoryMode } from "./hud";
import type { ItemInspectionController } from "./item-inspection-controller";
import {
  MAX_INVENTORY_SLOT_CAPACITY,
  inventorySlotCapacity,
  inventorySlotUnlockCost,
} from "../../shared/gems";
import { gemSpendConfirmationText } from "./gem-spend-confirmation";

type InventoryLocation = EquipmentSlot | "BAG" | "";
type SelectableInventory = InventoryState & { selectedItemId: string; selectedItemLocation?: InventoryLocation };

type InventoryDependencies = {
  inventory: SelectableInventory;
  move: (itemId: string, destination: EquipmentSlot | "BAG") => boolean;
  moveCosmetic: (itemId: string, destination: EquipmentSlot | "BAG") => boolean;
  toggleCosmeticVisibility: (destination: EquipmentSlot) => boolean;
  upgradeLevel: (itemId: string) => number;
  itemInspection: ItemInspectionController;
  inventorySlotsUnlocked: () => number;
  gemBalance: () => bigint;
  destroyEquipment: (itemId: string) => Promise<{ ok: boolean; error?: string } | undefined>;
  unlockInventorySlot: () => Promise<{ ok: boolean; error?: string } | undefined>;
  confirmGemSpend?: (message: string) => boolean;
  showMessage: (message: string, color?: string) => void;
};

export function clearInventorySelection(inventory: Pick<SelectableInventory, "selectedItemId" | "selectedItemLocation">) {
  inventory.selectedItemId = "";
  inventory.selectedItemLocation = "";
}

/** Inspect items with one tap; loadout changes are explicit inspection actions. */
export function createInventoryController(dependencies: InventoryDependencies) {
  const panel = requiredElement("inventoryPanel");
  const items = requiredElement("inventoryItems");
  const count = requiredElement("inventoryCount");
  const equippedHead = requiredElement("equippedHeadSlot");
  const equippedChest = requiredElement("equippedChestSlot");
  const equippedFeet = requiredElement("equippedFeetSlot");
  const equippedRightHand = requiredElement("equippedRightHandSlot");
  const equipmentTab = requiredElement<HTMLButtonElement>("inventoryEquipmentTab");
  const cosmeticsTab = requiredElement<HTMLButtonElement>("inventoryCosmeticsTab");
  const content = requiredElement("inventoryContent");
  const loadout = panel.querySelector<HTMLElement>(".inventory-loadout");
  const cosmeticsNote = document.createElement("p");
  cosmeticsNote.className = "inventory-cosmetics-note";
  cosmeticsNote.textContent = "In progress — coming soon: use Gems to turn equipment into cosmetics.";
  cosmeticsNote.hidden = true;
  count.after(cosmeticsNote);
  let renderedState = "";
  let mode: InventoryMode = "EQUIPMENT";
  let unlockingSlot = false;
  const confirmGemSpend = dependencies.confirmGemSpend ?? ((message: string) => confirm(message));

  const equipmentElements: Record<EquipmentSlot, HTMLElement> = {
    HEAD: equippedHead,
    CHEST: equippedChest,
    FEET: equippedFeet,
    RIGHT_HAND: equippedRightHand,
    LEFT_HAND: equippedRightHand,
  };
  function playMoveFeedback(destination: EquipmentSlot | "BAG") {
    if (destination !== "BAG") {
      const target = equipmentElements[destination];
      target.classList.remove("is-equipped-now");
      void target.offsetWidth;
      target.classList.add("is-equipped-now");
      window.setTimeout(() => target.classList.remove("is-equipped-now"), 360);
    }
    if (typeof navigator.vibrate === "function") navigator.vibrate(10);
  }

  function move(itemId: string, destination: EquipmentSlot | "BAG") {
    const moved = mode === "COSMETICS"
      ? dependencies.moveCosmetic(itemId, destination)
      : dependencies.move(itemId, destination);
    if (!moved) return false;
    clearInventorySelection(dependencies.inventory);
    render();
    playMoveFeedback(destination);
    return true;
  }

  function inspect(itemId: string, location: Exclude<InventoryLocation, "">) {
    clearInventorySelection(dependencies.inventory);
    const item = itemDefinition(itemId);
    if (!item) return;
    const visuallyEquipped = location !== "BAG";
    const context = mode === "COSMETICS"
      ? `${item.slot} · VISUAL ONLY · ${visuallyEquipped ? "COSMETIC ACTIVE" : "OWNED"}`
      : `${item.slot} · ${visuallyEquipped ? "EQUIPPED" : "IN BAG"}`;
    const description = mode === "COSMETICS"
      ? `${item.description} Cosmetic slots change appearance only; Equipment supplies your stats.`
      : item.description;
    dependencies.itemInspection.open({
      itemId,
      upgradeLevel: dependencies.upgradeLevel(itemId),
      context,
      description,
      actions: [...inventoryMoveActions(dependencies.inventory, itemId, location, mode).map((action) => ({
        label: action.label,
        kind: action.destination === "BAG" ? "SECONDARY" as const : "PRIMARY" as const,
        disabled: action.disabled,
        onActivate: () => {
          if (move(itemId, action.destination)) dependencies.itemInspection.close();
        },
      })), ...destructionActions(itemId)],
    });
  }

  function destructionActions(itemId: string) {
    if (!dependencies.inventory.itemIds.includes(itemId)) return [];
    return canDestroyEquipment(itemId) ? [{
      label: "Destroy item",
      kind: "DESTROY" as const,
      onActivate: async () => {
        if (!confirm(`Destroy ${itemDisplayName(itemId, dependencies.upgradeLevel(itemId))} permanently?`)) return;
        dependencies.itemInspection.close();
        const result = await dependencies.destroyEquipment(itemId);
        if (result?.ok) {
          clearInventorySelection(dependencies.inventory);
          render();
          dependencies.showMessage("ITEM DESTROYED", "#ff9b91");
        } else dependencies.showMessage(result?.error ?? "NOT CONNECTED", "#ff9b91");
      },
    }] : [];
  }

  function render() {
    const inventory = dependencies.inventory;
    const nextState = JSON.stringify([mode, inventory, dependencies.inventorySlotsUnlocked(), unlockingSlot,
      inventory.itemIds.map(itemId => dependencies.upgradeLevel(itemId))]);
    if (nextState === renderedState) return;
    renderedState = nextState;
    const cosmeticsActive = mode === "COSMETICS";
    cosmeticsNote.hidden = !cosmeticsActive;
    equipmentTab.classList.toggle("is-active", !cosmeticsActive);
    equipmentTab.setAttribute("aria-selected", String(!cosmeticsActive));
    equipmentTab.tabIndex = cosmeticsActive ? -1 : 0;
    cosmeticsTab.classList.toggle("is-active", cosmeticsActive);
    cosmeticsTab.setAttribute("aria-selected", String(cosmeticsActive));
    cosmeticsTab.tabIndex = cosmeticsActive ? 0 : -1;
    content.setAttribute("aria-labelledby", cosmeticsActive ? cosmeticsTab.id : equipmentTab.id);
    if (loadout) loadout.setAttribute("aria-label", cosmeticsActive ? "Cosmetic items" : "Equipped items");
    const slotsUnlocked = dependencies.inventorySlotsUnlocked();
    const slotCapacity = inventorySlotCapacity(slotsUnlocked);
    renderInventoryView(
      { items, count, equippedHead, equippedChest, equippedFeet, equippedRightHand },
      dependencies.inventory,
      mode,
      {
        onInspect: inspect,
        upgradeLevel: dependencies.upgradeLevel,
        slotCapacity,
        nextSlotCost: slotCapacity < MAX_INVENTORY_SLOT_CAPACITY
          ? inventorySlotUnlockCost(slotsUnlocked)
          : undefined,
        onUnlockSlot: unlockingSlot || slotCapacity >= MAX_INVENTORY_SLOT_CAPACITY
          ? undefined
          : () => { void unlockNextSlot(); },
      },
    );
  }

  async function unlockNextSlot() {
    if (unlockingSlot) return;
    const slotsUnlocked = dependencies.inventorySlotsUnlocked();
    const capacity = inventorySlotCapacity(slotsUnlocked);
    if (capacity >= MAX_INVENTORY_SLOT_CAPACITY) return;
    const cost = inventorySlotUnlockCost(slotsUnlocked);
    if (dependencies.gemBalance() < cost) {
      dependencies.showMessage(`NOT ENOUGH GEMS · NEED ${cost}`, "#ff9b91");
      return;
    }
    if (!confirmGemSpend(gemSpendConfirmationText(`permanently unlock Bag slot ${capacity + 1}`, cost))) return;
    unlockingSlot = true;
    render();
    const result = await dependencies.unlockInventorySlot();
    unlockingSlot = false;
    render();
    if (result?.ok) dependencies.showMessage(`BAG SLOT ${capacity + 1} UNLOCKED`, "#f3a6ce");
    else if (result?.error) dependencies.showMessage(result.error, "#ff9b91");
  }

  function itemInSlot(destination: EquipmentSlot) {
    if (mode === "COSMETICS") {
      return destination === "HEAD" ? dependencies.inventory.cosmeticHead
        : destination === "CHEST" ? dependencies.inventory.cosmeticChest
          : destination === "FEET" ? dependencies.inventory.cosmeticFeet
            : destination === "RIGHT_HAND" ? dependencies.inventory.cosmeticRightHand
              : dependencies.inventory.cosmeticLeftHand;
    }
    return destination === "HEAD" ? dependencies.inventory.equippedHead
      : destination === "CHEST" ? dependencies.inventory.equippedChest
        : destination === "FEET" ? dependencies.inventory.equippedFeet
          : destination === "RIGHT_HAND" ? dependencies.inventory.equippedRightHand
            : dependencies.inventory.equippedLeftHand;
  }

  function clickEquipment(destination: EquipmentSlot, itemId: string) {
    if (mode === "COSMETICS" && !itemDefinition(itemId)) {
      if (dependencies.toggleCosmeticVisibility(destination)) {
        clearInventorySelection(dependencies.inventory);
        render();
        playMoveFeedback(destination);
      }
      return;
    }
    if (!itemDefinition(itemId)) return;
    inspect(itemId, destination);
  }

  equippedHead.addEventListener("click", () => clickEquipment("HEAD", itemInSlot("HEAD")));
  equippedChest.addEventListener("click", () => clickEquipment("CHEST", itemInSlot("CHEST")));
  equippedRightHand.addEventListener("click", () => {
    const destination = inventoryWeaponSlot(dependencies.inventory, mode);
    clickEquipment(destination, itemInSlot(destination));
  });
  equippedFeet.addEventListener("click", () => clickEquipment("FEET", itemInSlot("FEET")));
  const setMode = (nextMode: InventoryMode) => {
    if (mode === nextMode) return;
    mode = nextMode;
    clearInventorySelection(dependencies.inventory);
    render();
  };
  equipmentTab.addEventListener("click", () => setMode("EQUIPMENT"));
  cosmeticsTab.addEventListener("click", () => setMode("COSMETICS"));
  for (const tab of [equipmentTab, cosmeticsTab]) {
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const nextTab = tab === equipmentTab ? cosmeticsTab : equipmentTab;
      setMode(nextTab === cosmeticsTab ? "COSMETICS" : "EQUIPMENT");
      nextTab.focus();
    });
  }

  return {
    destructionActions,
    render,
    prepareOpen: () => {
      dependencies.itemInspection.close();
      clearInventorySelection(dependencies.inventory);
    },
    mode: () => mode,
  };
}
