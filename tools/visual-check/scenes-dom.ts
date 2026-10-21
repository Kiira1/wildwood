// DOM scenes: the game's own index.html markup and stylesheets, filled by the game's own UI code.
import { renderInventoryView, renderPlayerHud } from "../../src/ui/hud";
import { ITEM_DEFINITIONS, type InventoryState } from "../../src/game/inventory";
import { itemPresentation } from "../../src/game/item-presentation";
import { createInventoryCharacterPreview } from "../../src/game/runtime/inventory-character-preview";
import { bindPlayerNameTags } from "../../src/app/player-name-tags";
import { applyProfileIcon } from "../../src/app/profile-icons";
import { GEAR_GRADES } from "../../shared/gear-grades";
import { isGradeItemId, gradeOf } from "../../shared/grade-equipment";
import { PLAYER_GENDER_MALE } from "../../shared/player-gender";
import { settleFrames, settleImages } from "./determinism";
import { GROUND, playerAppearance } from "./world";

let markup: Promise<Document> | null = null;

/** public/index.html, parsed (scripts never run), with its stylesheets added to this page. */
async function gameMarkup() {
  markup ??= (async () => {
    const response = await fetch("index.html");
    if (!response.ok) throw new Error(`index.html: ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const loads: Promise<unknown>[] = [];
    for (const node of doc.head.querySelectorAll("style, link[rel=stylesheet]")) {
      const copy = document.importNode(node, true) as HTMLElement;
      if (copy instanceof HTMLLinkElement) loads.push(new Promise((resolve, reject) => {
        copy.addEventListener("load", resolve, { once: true });
        copy.addEventListener("error", () => reject(new Error(`stylesheet ${copy.href}`)), { once: true });
      }));
      document.head.append(copy);
    }
    await Promise.all(loads);
    return doc;
  })();
  return markup;
}

async function importById(id: string) {
  const doc = await gameMarkup();
  const source = doc.getElementById(id);
  if (!source) throw new Error(`index.html has no #${id}`);
  const element = document.importNode(source, true) as HTMLElement;
  // Relative asset paths resolve against this page, as they do against the game's.
  document.body.append(element);
  return element;
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
};

/** Waits for every CSS background and mask image on the page, which the image tracker does not see. */
async function settleCssImages() {
  const urls = new Set<string>();
  for (const element of document.querySelectorAll<HTMLElement>("*")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const style = getComputedStyle(element, pseudo);
      for (const value of [style.backgroundImage, style.maskImage, style.getPropertyValue("-webkit-mask-image")]) {
        for (const match of value.matchAll(/url\("?([^")]+)"?\)/g)) urls.add(match[1]);
      }
    }
  }
  await Promise.all([...urls].map(url => {
    const image = new Image();
    image.src = url;
    return image.decode().catch(() => {});
  }));
  await document.fonts.ready;
  await settleImages();
  await settleFrames();
}

const BAG_REFINE_SAMPLE_GRADES = new Set<string>([GEAR_GRADES[0], GEAR_GRADES[5], GEAR_GRADES[9], GEAR_GRADES[GEAR_GRADES.length - 1]]);

/**
 * The inventory window open on a full bag: every item with bag art, and for a few grades each graded piece
 * again at ★10 and ★20 (kept copies carry their own refine). The window is unpinned from the viewport
 * so the whole bag lands in one full-page capture.
 */
async function icons() {
  // The window alone: no stylesheet rule depends on where it sits in the HUD.
  const hudElement = await importById("hud");
  const panel = hudElement.querySelector<HTMLElement>("#inventoryPanel")!;
  document.body.append(panel);
  hudElement.remove();
  panel.hidden = false;
  const unpin = document.createElement("style");
  unpin.textContent = `
    html, body { position: static !important; height: auto !important; overflow: visible !important; }
    .card.inventory-panel { position: relative !important; inset: auto !important; min-height: 100vh; overflow: visible !important; }
    .inventory-panel .inventory-scroll, .inventory-panel .inventory-content { overflow: visible !important; max-height: none !important; }
  `;
  document.head.append(unpin);
  const items = Object.keys(ITEM_DEFINITIONS).filter(id => itemPresentation(id)?.inventory.source);
  const inventory: InventoryState = {
    itemIds: items, cosmeticItemIds: [],
    equippedHead: "legendary_heavy_helmet", equippedChest: "legendary_heavy_armor", equippedFeet: "legendary_warrior_boots",
    equippedRightHand: "legendary_bow", equippedLeftHand: "",
    cosmeticHead: "", cosmeticChest: "", cosmeticFeet: "", cosmeticRightHand: "", cosmeticLeftHand: "",
  };
  const copies = items.filter(id => isGradeItemId(id) && BAG_REFINE_SAMPLE_GRADES.has(gradeOf(id)!))
    .flatMap((itemId, index) => [{ id: BigInt(index * 2 + 1), itemId }, { id: BigInt(index * 2 + 2), itemId }]);
  const refineLevel = (_itemId: string, copyId = 0n) => copyId === 0n ? 0 : copyId % 2n ? 10 : 20;
  renderInventoryView({
    items: byId("inventoryItems"), count: byId("inventoryCount"),
    equippedHead: byId("equippedHeadSlot"), equippedChest: byId("equippedChestSlot"),
    equippedFeet: byId("equippedFeetSlot"), equippedRightHand: byId("equippedRightHandSlot"),
  }, { ...inventory, selectedItemId: "" }, "EQUIPMENT", {
    onInspect: () => {}, upgradeLevel: () => 0, slotTier: () => 7, refineLevel, slotCapacity: items.length + copies.length,
    copies, nextSlotCost: 150n,
  });
  const preview = createInventoryCharacterPreview(byId<HTMLCanvasElement>("inventoryCharacterCanvas"), await playerAppearance());
  const drawPreview = () => preview.draw({ visible: true, inventory, skinTone: 2, power: 54_321 });
  drawPreview();
  await settleCssImages();
  drawPreview();
  await settleFrames();
}

/** The in-game HUD over plain ground: player card, toolbar icons, gem wallet, minimap and chat. */
async function hud() {
  document.body.style.background = GROUND;
  await importById("hud");
  bindPlayerNameTags({ prefix: () => "[TheG]", revision: () => 0, prestigeLevel: () => 4 });
  renderPlayerHud({
    hpFill: byId("hpFill"), hpText: byId("hpText"), playerName: byId("playerName"), playerPower: byId("playerPower"),
    coopStatus: byId("coopStatus"), minimapPlayers: byId("minimapPlayers"),
  }, { hp: 840, maxHp: 1_200 }, "Rymel", 12, 12_345, false, PLAYER_GENDER_MALE, "p-local", false);
  byId("hudGemBalance").textContent = "1,250";
  applyProfileIcon(byId("playerHudProfileIcon"), 0);
  await settleCssImages();
}

/** The start screen's wordmark and choice panel, as a new visitor first sees them. */
async function wordmark() {
  await importById("start");
  await settleCssImages();
}

export const DOM_SCENES: Record<string, () => Promise<void>> = { icons, hud, wordmark };
