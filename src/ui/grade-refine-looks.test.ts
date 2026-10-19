import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createInventoryController } from "./inventory-controller";
import { createItemInspectionController } from "./item-inspection-controller";
import { profileEquipmentPresentation, profileEquipmentRefine, renderProfileEquipmentSlot, type ProfileEquipmentProgress } from "./profile-equipment";
import { STARTER_STONE } from "../game/inventory";
import { wornItemRefine } from "../game/local-item-refines";
afterEach(() => vi.unstubAllGlobals());

// Graded gear shows its refine look wherever it is drawn: base below ★10, then the ★10 and ★20 looks.
const PARTS = "assets/wildstat/player-parts";
const art = (element: Element) => element.querySelector(".inventory-item-art")?.getAttribute("style") ?? "";

describe("graded gear refine looks in the bag", () => {
  it("draws the worn piece and each bag piece in its own refine look", () => {
    const ids = ["inventoryPanel", "inventoryItems", "inventoryCount", "equippedHeadSlot", "equippedChestSlot", "equippedFeetSlot", "equippedRightHandSlot", "inventoryEquipmentTab", "inventoryCosmeticsTab", "inventoryContent"];
    const { document, window } = parseHTML(`<html><body>${ids.map(id => `<div id="${id}"></div>`).join("")}</body></html>`);
    vi.stubGlobal("document", document); vi.stubGlobal("window", window); vi.stubGlobal("navigator", {});
    const refines: Record<string, number> = { rare_bow: 12, epic_light_helmet: 24, fine_heavy_armor: 4 };
    const inventory = { itemIds: [STARTER_STONE, "rare_bow", "epic_light_helmet", "fine_heavy_armor"], equippedHead: "", equippedChest: "", equippedFeet: "",
      equippedRightHand: "rare_bow", equippedLeftHand: "", cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "",
      selectedItemId: "", selectedItemLocation: "" as const };
    createInventoryController({ inventory, toggleCosmeticVisibility: () => false,
      move: () => true, moveCosmetic: () => false, upgradeLevel: () => 0, inventorySlotsUnlocked: () => 0, gemBalance: () => 0n,
      refineLevel: (itemId, copyId = 0n) => (copyId ? 0 : refines[itemId] ?? 0), ores: () => ({}),
      itemInspection: { close() {}, open() { return true; }, openOre() { return true; } } as any,
      destroyEquipment: async () => ({ ok: true }), destroyEquipmentCopy: async () => ({ ok: true }),
      equipmentCopies: () => [], confirmDestroy: async () => false, unlockInventorySlot: async () => undefined, showMessage() {} }).render();
    const tile = (itemId: string) => document.querySelector(`#inventoryItems [data-item-id="${itemId}"]`)!;
    expect(art(document.getElementById("equippedRightHandSlot")!)).toContain(`${PARTS}/rare-bow-r10.webp`);
    expect(art(tile("epic_light_helmet"))).toContain(`${PARTS}/epic-light-helmet-r20.webp`);
    expect(art(tile("fine_heavy_armor"))).toContain(`${PARTS}/fine-heavy-armor.webp`);
  });
});

describe("graded gear refine looks in the item window", () => {
  it("shows the inspected copy's refine look", () => {
    const { document, window } = parseHTML(`<html><body><section id="panel" hidden><div class="item-inspection-tools"></div>
      <h2 id="title"></h2><div id="content"></div><button id="back"></button></section></body></html>`);
    vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", window.HTMLElement);
    const controller = createItemInspectionController({
      panel: document.getElementById("panel")!, title: document.getElementById("title")!,
      content: document.getElementById("content")!, back: document.getElementById("back") as HTMLButtonElement,
    });
    const icon = () => document.querySelector(".item-inspection-icon img")!.getAttribute("src");
    controller.open({ itemId: "legendary_staff", upgradeLevel: 0, refine: 20 });
    expect(icon()).toBe(`${PARTS}/legendary-staff-r20.webp`);
    controller.open({ itemId: "legendary_staff", upgradeLevel: 0, refine: 9 });
    expect(icon()).toBe(`${PARTS}/legendary-staff.webp`);
  });
});

describe("graded gear refine looks on a profile", () => {
  const equipment = (overrides: Partial<ProfileEquipmentProgress> = {}): ProfileEquipmentProgress => ({
    equippedHead: "mythic_magic_helmet", equippedChest: "", equippedFeet: "", equippedRightHand: "mythic_staff", equippedLeftHand: "",
    cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "", ...overrides,
  });

  it("draws worn gear in its refine look and a look over it in the look's base", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    const refines = { mythic_staff: 15, mythic_magic_helmet: 22, rare_magic_helmet: 30 };
    const slot = (progress: ProfileEquipmentProgress, which: "HEAD" | "WEAPON") => {
      const presentation = profileEquipmentPresentation(progress, which);
      const element = document.createElement("button") as unknown as HTMLButtonElement;
      renderProfileEquipmentSlot(element, presentation, 0, profileEquipmentRefine(presentation, refines));
      return art(element);
    };
    expect(slot(equipment(), "WEAPON")).toContain(`${PARTS}/mythic-staff-r10.webp`);
    expect(slot(equipment(), "HEAD")).toContain(`${PARTS}/mythic-magic-helmet-r20.webp`);
    expect(slot(equipment({ cosmeticHead: "rare_magic_helmet" }), "HEAD")).toContain(`${PARTS}/rare-magic-helmet.webp`);
  });

  it("gives the character preview the worn pieces' refines only", () => {
    const refines: Record<string, number> = { mythic_staff: 15, rare_magic_helmet: 30 };
    const refine = wornItemRefine(equipment({ cosmeticHead: "rare_magic_helmet" }), itemId => refines[itemId] ?? 0);
    expect([refine("mythic_staff"), refine("rare_magic_helmet"), refine("")]).toEqual([15, 0, 0]);
  });
});
