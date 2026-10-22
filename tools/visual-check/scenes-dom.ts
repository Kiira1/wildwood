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
import { craftExperienceForLevel } from "../../shared/crafting";
import { createSmithController } from "../../src/ui/smith-window";
import { createGearSellerController, type GearSellerDeps } from "../../src/ui/gear-seller-window";
import { renderProfileGuild } from "../../src/ui/profile-guild";
import { createProfileActionsMenu } from "../../src/ui/profile-actions-menu";
import { createGemShopController } from "../../src/ui/gem-shop-controller";
import { createChatAnnouncementLine } from "../../src/ui/chat-announcement-line";
import { createDiamondLookDrawer } from "../../src/game/runtime/diamond-look-preview";
import { installServerBoostHud } from "../../src/ui/server-boost-hud";
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

/**
 * The Smith on each of Craft, Reforge and Refine, the Weapon Seller on Sell and the Armor Seller on Buy, filled by their
 * own window code from fake rows. Each window keeps its real size, so its pinned detail and grid show as in the game;
 * they are stacked so one full-page capture shows all five.
 */
async function shops() {
  await gameMarkup();
  document.body.style.background = GROUND;
  const unpin = document.createElement("style");
  unpin.textContent = `
    html, body { position: static !important; height: auto !important; overflow: visible !important; }
    dialog.farm-sheet[open] { position: relative !important; inset: auto !important; margin: 12px auto !important; }
  `;
  document.head.append(unpin);
  const ores = { pine_log: 900, oak_log: 40, copper_ore: 300, iron_ore: 12, starshard: 5 };
  const bow = { arrowStorm: 3.1, ricochet: 1.2, piercingShot: 0 }, sword = { whirlwind: 2, deflect: 0, shockwave: 1.5 };
  const done = async () => ({ ok: true });
  const held = [
    { itemId: "rare_bow", copyId: 0n, equipped: true },
    { itemId: "rare_bow", copyId: 7n, equipped: false },
    { itemId: "fine_sword", copyId: 0n, equipped: false },
    { itemId: "rare_light_helmet", copyId: 0n, equipped: true },
    { itemId: "fine_light_armor", copyId: 0n, equipped: true },
    { itemId: "common_ranger_boots", copyId: 0n, equipped: true },
  ];
  for (const view of ["craft", "reforge", "refine"] as const) {
    createSmithController({
      inTown: () => true, items: () => held, refineLevel: (_itemId, copyId) => copyId ? 2 : 7, slotTier: () => 3, ores: () => ores, refine: done,
      showMessage: () => {},
      craft: {
        craftSkills: () => ({ fletching: BigInt(craftExperienceForLevel(24)), smithing: BigInt(craftExperienceForLevel(6)) }),
        ores: () => ores, masteryLevels: () => ({ archery: 20 }), bagFull: () => false, craft: done,
        weapons: () => [
          { itemId: "rare_bow", copyId: 0n, equipped: true, roll: bow },
          { itemId: "rare_bow", copyId: 7n, equipped: false, roll: { arrowStorm: 0, ricochet: 2, piercingShot: 0.8 } },
          { itemId: "fine_sword", copyId: 0n, equipped: false, roll: sword },
        ],
        refineLevel: (_itemId, copyId) => copyId ? 2 : 7, reforge: done, showMessage: () => {},
      },
    }).open(view);
  }
  try { localStorage.setItem("wildstat.gearSellerView.weapons", "sell"); localStorage.setItem("wildstat.gearSellerView.armor", "buy"); } catch { /* the default views */ }
  const seller: GearSellerDeps = {
    inTown: () => true, showMessage: () => {}, gold: () => 12_480n, masteryLevels: () => ({ archery: 20 }),
    heldItems: () => ["rare_bow", "fine_sword", "rare_light_helmet"], bagFull: () => false, buyGear: done,
    worn: () => ({ equippedRightHand: "rare_bow", equippedHead: "rare_light_helmet" }), slotTier: () => 3,
    refineLevel: (_itemId, copyId) => copyId ? 2 : 7,
    items: () => [
      { itemId: "rare_bow", copyId: 0n, equipped: true, roll: bow },
      { itemId: "rare_bow", copyId: 7n, equipped: false, roll: { arrowStorm: 0, ricochet: 2, piercingShot: 0.8 } },
      { itemId: "fine_sword", copyId: 0n, equipped: false, roll: sword },
      { itemId: "crude_staff", copyId: 0n, equipped: false, roll: null },
    ],
    locked: (_itemId, copyId) => copyId === 7n, sell: done,
  };
  createGearSellerController("weapons", seller).open();
  createGearSellerController("armor", seller).open();
  for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) { dialog.close(); dialog.show(); }
  await settleCssImages();
}

/** The gem Shop on the web: the Patreon rows and the dev note with its three frames and the Diamond Galaxy set. */
async function gemShop() {
  await gameMarkup();
  document.body.style.background = GROUND;
  const assets = await playerAppearance();
  const button = document.createElement("button");
  document.body.append(button);
  createGemShopController({ button, setOpen: () => {}, drawDiamondLook: createDiamondLookDrawer(assets) }).open();
  await settleCssImages();
}

/**
 * The profile window's header from the game shell's own markup: the name, online line and guild row,
 * the pencil on your own and the ⋯ button on anyone else's. The stats and preview stay empty.
 */
async function profileWindow(own: boolean) {
  const doc = await gameMarkup();
  document.body.style.background = GROUND;
  for (const node of doc.body.children) document.body.append(document.importNode(node, true));
  await import("../../src/ui/game-shell");
  byId("playerProfile").hidden = false;
  byId("playerProfileName").textContent = own ? "Rymel" : "Moss";
  const presence = byId("playerProfilePresence");
  presence.textContent = "Online - Forest"; presence.classList.add("is-online");
  applyProfileIcon(byId("playerProfileIcon"), own ? 0 : 3);
  renderProfileGuild(byId<HTMLButtonElement>("playerProfileGuild"), "TheG", { id: "1", name: "TheG", emblem: 5 });
  byId("editPlayerNameBtn").hidden = !own;
  byId("settingsBtn").hidden = !own;
  byId("profileMoreBtn").hidden = own;
  byId("profileDuelBtn").hidden = own;
  if (!own) createProfileActionsMenu({ isBlocked: () => false, openSafety: () => {}, showMessage: () => {} }).open("p-moss", "Moss");
  await settleCssImages();
}

/**
 * The Server Boost: its timer at the top of the column under the minimap, and the Shop's row three ways
 * (a supporter on cooldown during a boost, a supporter ready, a non-supporter), stacked at phone width.
 */
async function serverBoost() {
  await hud();
  const column = document.createElement("div");
  column.className = "hud-timer-column";
  document.querySelector(".minimap-meta")!.append(column);
  installServerBoostHud(() => 14 * 60_000 + 32_000);
  const unpin = document.createElement("style");
  unpin.textContent = `
    html, body { position: static !important; height: auto !important; overflow: visible !important; }
    dialog.gem-shop[open] { position: relative !important; inset: auto !important; height: auto !important; margin: 12px auto !important; }
    dialog.gem-shop .gem-shop-scroll { overflow: visible !important; max-height: none !important; }
  `;
  document.head.append(unpin);
  const done = async () => ({ ok: true });
  const views = [
    { serverBoost: () => ({ remainingMs: 14 * 60_000 + 32_000, supporterName: "Moss", cooldownMs: 22 * 3_600_000 + 5 * 60_000 }), supporterTier: () => "gold" },
    { serverBoost: () => ({ remainingMs: 0, supporterName: "", cooldownMs: 0 }), supporterTier: () => "silver" },
    { serverBoost: () => ({ remainingMs: 0, supporterName: "", cooldownMs: 0 }), supporterTier: () => "none" },
  ];
  for (const view of views) {
    const button = document.createElement("button");
    document.body.append(button);
    createGemShopController({ button, setOpen: () => {}, serverBoost: { ...view, triggerServerBoost: done, localIdentity: () => "p-local" } }).open();
  }
  await settleCssImages();
}

/** Public chat, compact and expanded: a player's line, the server's Server Boost and Patreon banners, and the same words typed by a player. */
async function chatAnnouncement() {
  const unpin = document.createElement("style");
  unpin.textContent = `
    html, body { position: static !important; height: auto !important; overflow: visible !important; }
    #chatPanel { position: relative !important; inset: auto !important; transform: none !important; margin: 12px auto !important; }
    #chatPanel.is-large { width: 100% !important; height: auto !important; }
    #chatPanel #chatMessages { height: auto !important; max-height: none !important; overflow: visible !important; }
  `;
  document.head.append(unpin);
  const sentAtMs = Date.UTC(2026, 9, 21, 15, 42);
  const boost = "Started a Server Boost: 2x Rewards for 15 min";
  const playerLine = (name: string, words: string) => {
    const line = document.createElement("div");
    line.className = "chat-line";
    line.innerHTML = '<span class="chat-profile-icon"></span><div class="chat-message-content"><span class="chat-name"></span>'
      + '<span class="chat-text"><span class="chat-message-body"><span></span></span></span></div>';
    line.querySelector(".chat-name")!.textContent = name;
    line.querySelector(".chat-message-body span")!.textContent = words;
    return line;
  };
  const portrait = (index: number) => {
    const icon = document.createElement("span");
    icon.className = "chat-profile-icon";
    applyProfileIcon(icon, index);
    return icon;
  };
  for (const large of [false, true]) {
    const panel = await importById("chatPanel");
    panel.classList.toggle("is-large", large);
    const messages = panel.querySelector("#chatMessages")!;
    const rows = [
      playerLine("Moss", "anyone up for the boss?"),
      createChatAnnouncementLine({ id: 1n, senderName: "Oogway", message: boost, sentAtMs }, "server-boost", large, portrait(3)),
      createChatAnnouncementLine({ id: 2n, senderName: "Oogway",
        message: "Extended a Server Boost by 15 min", sentAtMs }, "server-boost", large, portrait(3)),
      createChatAnnouncementLine({ id: 3n, senderName: "Fern", message: "Became a Gold supporter on Patreon. Thank you for supporting WildStat! ♥", sentAtMs }, "patreon", large, portrait(5)),
      playerLine("Faker", boost),
    ];
    messages.append(...(large ? rows : rows.slice(1, 2).concat(rows.slice(4))));
  }
  await settleCssImages();
}

export const DOM_SCENES: Record<string, () => Promise<void>> = { icons, hud, wordmark, shops, "gem-shop": gemShop, "server-boost": serverBoost,
  "chat-announcement": chatAnnouncement,
  "profile-own": () => profileWindow(true), "profile-other": () => profileWindow(false) };
