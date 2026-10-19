import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createInventoryController, type KeptEquipmentCopy } from "./inventory-controller";
import { createItemInspectionController, itemInspectionButtonLabel, type ItemInspectionRequest } from "./item-inspection-controller";
import type { ConfirmRequest } from "./confirm-dialog";
import { formatEquipmentStat } from "./equipment-stat-format";
import { profileEquipmentPresentation, profileEquipmentRefine, renderProfileEquipmentSlot, type ProfileEquipmentProgress } from "./profile-equipment";
import { profileStatDisplayRows } from "./profile";
import { refineStars, withRefineStars } from "./refine-badge";
import { IRON_BOW, SAMURAI_HAT, STARTER_STONE } from "../game/inventory";
import { BASIC_PAPER_HAT, WOODEN_ARMOR, itemStats } from "../../shared/items";
import { createEmptyResearchRanks } from "../../shared/research";
import { MIN_ATTACK_INTERVAL } from "../../shared/rules";
import type { OreId } from "../../shared/refine";
import { inventorySlotCapacity } from "../../shared/gems";
afterEach(() => vi.unstubAllGlobals());

// A refine is one copy's (★N, gold); the slot's tier keeps its green +N.
const ROLL = { arrowStorm: 0, ricochet: 3, piercingShot: 0 };
const REFINES: Record<string, number> = { [`${IRON_BOW}:0`]: 5, [`${IRON_BOW}:5`]: 2 };

function bag(copies: KeptEquipmentCopy[] = [{ id: 5n, itemId: IRON_BOW, roll: ROLL }], ores: Partial<Record<OreId, number>> = {}) {
  const ids = ["inventoryPanel", "inventoryItems", "inventoryCount", "equippedHeadSlot", "equippedChestSlot", "equippedFeetSlot", "equippedRightHandSlot", "inventoryEquipmentTab", "inventoryCosmeticsTab", "inventoryContent"];
  const { document, window } = parseHTML(`<html><body>${ids.map(id => `<div id="${id}"></div>`).join("")}</body></html>`);
  vi.stubGlobal("document", document); vi.stubGlobal("window", window); vi.stubGlobal("navigator", {});
  const inventory = { itemIds: [STARTER_STONE, IRON_BOW, SAMURAI_HAT], equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: IRON_BOW, equippedLeftHand: "", cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "", selectedItemId: "", selectedItemLocation: "" as const };
  const opened: ItemInspectionRequest[] = [];
  const oreOpened: { oreId: string; count: number }[] = [];
  const asked: ConfirmRequest[] = [];
  const controller = createInventoryController({ inventory, toggleCosmeticVisibility: () => false,
    move: () => true, moveCosmetic: () => false, upgradeLevel: () => 0, inventorySlotsUnlocked: () => 0, gemBalance: () => 0n,
    refineLevel: (itemId, copyId = 0n) => REFINES[`${itemId}:${copyId}`] ?? 0, ores: () => ores,
    itemInspection: { close() {}, open(request: ItemInspectionRequest) { opened.push(request); return true; }, openOre(request: { oreId: string; count: number }) { oreOpened.push(request); return true; } } as any,
    destroyEquipment: async () => ({ ok: true }), destroyEquipmentCopy: async () => ({ ok: true }),
    equipmentCopies: () => copies, confirmDestroy: async request => { asked.push(request); return false; },
    unlockInventorySlot: async () => undefined, showMessage() {} });
  controller.render();
  const items = document.getElementById("inventoryItems")!;
  const tile = (itemId: string, copyId?: bigint) => [...items.querySelectorAll<HTMLElement>(`[data-item-id="${itemId}"]`)]
    .find(button => button.getAttribute("data-copy-id") === (copyId === undefined ? null : String(copyId)))!;
  const star = (element: Element) => element.querySelector(".refine-badge")?.textContent ?? null;
  return { document, items, tile, star, opened, oreOpened, asked, controller };
}

describe("refines in the inventory", () => {
  it("marks the worn slot with the first copy's ★ and each bag copy with its own, counted in the tile's stats", () => {
    const view = bag();
    const slot = view.document.getElementById("equippedRightHandSlot")!;
    expect(view.star(slot)).toBe("★5");
    expect(slot.getAttribute("aria-label")).toContain("★5");
    const copy = view.tile(IRON_BOW, 5n);
    expect(view.star(copy)).toBe("★2");
    expect(copy.getAttribute("aria-label")).toContain("★2");
    expect(copy.querySelector('[data-stat-kind="damage"]')!.getAttribute("aria-label")).toBe(itemStats(IRON_BOW, { refine: 2 })[0]);
    // Plain gear looks as it always has.
    expect(view.star(view.tile(SAMURAI_HAT))).toBeNull();
  });

  it("inspects each copy with its own refine, and names the ★ before a refined copy is destroyed", async () => {
    const view = bag();
    view.tile(IRON_BOW, 5n).click();
    const request = view.opened.at(-1)!;
    expect(request.refine).toBe(2);
    await request.actions!.find(action => action.kind === "DESTROY")!.onActivate();
    expect(view.asked.at(-1)!.message).toContain("★2");
    view.document.getElementById("equippedRightHandSlot")!.click();
    expect(view.opened.at(-1)!.refine).toBe(5);
  });

  it("draws the bag again when a refine changes", () => {
    const view = bag();
    REFINES[`${IRON_BOW}:5`] = 3;
    try {
      view.controller.render();
      expect(view.star(view.tile(IRON_BOW, 5n))).toBe("★3");
    } finally { REFINES[`${IRON_BOW}:5`] = 2; }
  });

  it("stacks each kind of ore held in a bag slot of its own after the gear, counted toward the bag", () => {
    const view = bag(undefined, { copper_ore: 22, adamant_ore: 0, starshard: 1 });
    const tiles = [...view.items.querySelectorAll<HTMLElement>(".inventory-item.is-filled")];
    const ores = tiles.filter(tile => tile.dataset.oreId);
    expect(ores.map(tile => [tile.dataset.oreId, tile.querySelector(".item-tier-label")?.textContent, tile.querySelector(".inventory-stack-count")?.textContent]))
      .toEqual([["copper_ore", "Copper", "22"], ["starshard", "Starshard", "1"]]);
    // After every piece of gear, and in the bag's count with it.
    expect(tiles.indexOf(ores[0])).toBe(tiles.length - 2);
    const gear = tiles.length - 2;
    expect(view.document.getElementById("inventoryCount")!.textContent).toBe(`${gear + 2} / ${inventorySlotCapacity(0)} Items`);
    expect(ores[0].getAttribute("aria-label")).toBe("Copper Ore, 22. Tap to inspect.");
    ores[0].click();
    expect(view.oreOpened).toEqual([{ oreId: "copper_ore", count: 22, actions: [] }]);
    // No ore held, no ore slot.
    expect(bag().items.querySelector(".is-ore")).toBeNull();
  });

  it("shows the ores alone under the Materials filter, and no ores under a gear filter", () => {
    const view = bag(undefined, { iron_ore: 3 });
    const filter = (label: string) => [...view.document.querySelectorAll<HTMLElement>(".inventory-filter")].find(button => button.textContent === label)!;
    filter("Materials").click();
    expect([...view.items.querySelectorAll<HTMLElement>(".inventory-item.is-filled")].map(tile => tile.dataset.oreId ?? tile.dataset.itemId)).toEqual(["iron_ore"]);
    filter("Helmets").click();
    expect(view.items.querySelector(".is-ore")).toBeNull();
  });

  it("never picks an ore stack in delete mode", () => {
    const view = bag(undefined, { copper_ore: 4 });
    view.document.querySelector<HTMLElement>(".inventory-delete-toggle")!.click();
    view.items.querySelector<HTMLElement>(".is-ore")!.click();
    expect(view.oreOpened).toEqual([]);
    expect(view.items.querySelector(".is-ore")!.classList.contains("is-delete-selected")).toBe(false);
  });

  it("warns before delete mode takes refined gear", async () => {
    const view = bag();
    view.document.querySelector<HTMLElement>(".inventory-delete-toggle")!.click();
    view.tile(IRON_BOW, 5n).click();
    view.tile(SAMURAI_HAT).click();
    view.document.querySelector<HTMLElement>(".inventory-delete-toggle")!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(view.asked.at(-1)!.details).toContainEqual({ label: "Refined Gear", value: "1 Item ★" });
  });
});

describe("refines in the item window", () => {
  function inspection() {
    const { document, window } = parseHTML(`<html><body><section id="panel" hidden><div class="item-inspection-tools"></div>
      <h2 id="title"></h2><div id="content"></div><button id="back"></button></section></body></html>`);
    vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", window.HTMLElement);
    const controller = createItemInspectionController({
      panel: document.getElementById("panel")!, title: document.getElementById("title")!,
      content: document.getElementById("content")!, back: document.getElementById("back") as HTMLButtonElement,
    });
    const lines = () => [...document.querySelectorAll(".item-inspection-stats span")].map(span => span.textContent);
    return { controller, lines, title: document.getElementById("title")! };
  }

  it("keeps the buttons out of the scrolling details, just above Back, so Equip is always in view", () => {
    const view = inspection();
    const equip = vi.fn();
    view.controller.open({ itemId: IRON_BOW, upgradeLevel: 3, actions: [{ label: "Equip", onActivate: equip }] });
    const content = document.getElementById("content")!, host = document.querySelector(".item-inspection-actions-host")!;
    expect(content.querySelector("button")).toBeNull();
    expect(host.previousElementSibling).toBe(content);
    expect(host.querySelector("button")!.textContent).toBe("Equip");
    (host.querySelector("button") as HTMLButtonElement).click();
    expect(equip).toHaveBeenCalledOnce();
    view.controller.close();
    expect(host.childElementCount).toBe(0);
  });

  it("names the item with its ★ in gold and counts the refine in its stats", () => {
    const view = inspection();
    view.controller.open({ itemId: IRON_BOW, upgradeLevel: 3, refine: 7 });
    expect(view.title.textContent).toBe("Stone Bow +3 ★7");
    expect(view.title.querySelector(".refine-stars")!.textContent).toBe(" ★7");
    expect(view.lines()).toEqual([formatEquipmentStat(itemInspectionButtonLabel(itemStats(IRON_BOW, { tier: 3, refine: 7 })[0]))]);
    view.controller.open({ itemId: IRON_BOW, upgradeLevel: 3 });
    expect(view.title.textContent).toBe("Stone Bow +3");
    expect(view.lines()).toEqual([formatEquipmentStat(itemInspectionButtonLabel(itemStats(IRON_BOW, 3)[0]))]);
  });
});

describe("refines on a profile", () => {
  const equipment = (overrides: Partial<ProfileEquipmentProgress> = {}): ProfileEquipmentProgress => ({
    equippedHead: BASIC_PAPER_HAT, equippedChest: WOODEN_ARMOR, equippedFeet: "", equippedRightHand: IRON_BOW, equippedLeftHand: "",
    cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "", ...overrides,
  });

  it("marks worn gear with its ★ beside the slot's +N, and a cosmetic with none", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    const refines = { [IRON_BOW]: 6, [SAMURAI_HAT]: 4 };
    const weapon = profileEquipmentPresentation(equipment(), "WEAPON");
    const slot = document.createElement("button") as unknown as HTMLButtonElement;
    renderProfileEquipmentSlot(slot, weapon, 2, profileEquipmentRefine(weapon, refines));
    expect(slot.querySelector(".refine-badge")!.textContent).toBe("★6");
    expect(slot.querySelector(".inventory-upgrade-level")!.textContent).toBe("+2");
    expect(slot.title).toContain("★6");
    // A cosmetic over the head only changes the look: the hat's refine is not the head's.
    const head = profileEquipmentPresentation(equipment({ cosmeticHead: SAMURAI_HAT }), "HEAD");
    expect(profileEquipmentRefine(head, refines)).toBe(0);
    const look = document.createElement("button") as unknown as HTMLButtonElement;
    renderProfileEquipmentSlot(look, head, 0, 4);
    expect(look.querySelector(".refine-badge")).toBeNull();
  });

  it("lists what refining added as its own line in the stat breakdown", () => {
    const progress = { maxHp: 100, damage: 20, attackRate: 1, projectileSpeed: 390, projectileCount: 1, attackRange: 260, armor: 10, regen: 2,
      speed: 190, speedOverride: 0, bootsCollected: false, inventoryJson: "[]", ...equipment({ equippedHead: "", equippedRightHand: "" }) };
    const profile = { progress, research: createEmptyResearchRanks(), itemUpgradeLevels: {}, itemRefines: { [WOODEN_ARMOR]: 4 } } as unknown as Parameters<typeof profileStatDisplayRows>[0];
    const health = profileStatDisplayRows(profile, () => "0%", MIN_ATTACK_INTERVAL).find(row => row.kind === "health")!;
    // Wooden Armor's +5% max health, refined to ★4: +20% of it, so +1%.
    expect(health.sources).toEqual([{ label: "Equipment", value: "+5%" }, { label: "Refine", value: "+1%" }]);
    const plain = profileStatDisplayRows({ ...profile, itemRefines: {} }, () => "0%", MIN_ATTACK_INTERVAL).find(row => row.kind === "health")!;
    expect(plain.sources).toEqual([{ label: "Equipment", value: "+5%" }]);
  });
});

it("writes a refine as a gold star and its level, and nothing at ★0", () => {
  expect([refineStars(7), refineStars(0), withRefineStars("Ion Bow", 7), withRefineStars("Ion Bow", 0)]).toEqual(["★7", "", "Ion Bow ★7", "Ion Bow"]);
});
