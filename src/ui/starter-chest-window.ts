import {
  STARTER_CHEST_POSITION, STARTER_CHEST_REACH, STARTER_CHEST_SERVER_REACH, STARTER_WEAPON_CHOICES, starterWeaponId, type StarterWeaponKind,
} from "../../shared/starter-chest";
import { TOWN_FEET_OFFSET } from "../../shared/town";
import { WEAPON_SCHOOL_NAMES } from "../../shared/weapon-mastery";
import { itemArtMarkup } from "../game/item-presentation";
import { starterChestScene } from "../game/runtime/render/starter-chest-renderer";
import { closeStationsOutOfReach } from "./station-reach";

type Result = { ok: boolean; error?: string };

/**
 * The Starter Chest's window: three cards, a Crude Bow, Sword and Staff, each with its art, school and what it
 * does. Picking one sends it to the server, which puts it in the bag and in the hand.
 */
export function createStarterChestWindow(deps: {
  choose: (kind: StarterWeaponKind) => Promise<Result>;
  showMessage: (text: string, color: string) => void;
  clearInput?: () => void;
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "farm-sheet quest-sheet smith-sheet starter-chest-window";
  dialog.setAttribute("aria-labelledby", "starterChestTitle");
  dialog.innerHTML = `<header class="farm-header"><h2 id="starterChestTitle" class="window-banner"><span>Choose Your Weapon</span></h2></header>`
    + `<div class="quest-body"><p class="farm-map smith-intro">Pick your first weapon. Every kill with it trains its school.</p>`
    + `<section class="smith-shop"><div class="smith-shop-rows" role="list" aria-label="Weapons to pick"></div></section></div>`
    + `<footer class="farm-footer"><div class="farm-actions"><button type="button" class="window-back-button">Back</button></div></footer>`;
  document.body.append(dialog);
  const rows = dialog.querySelector<HTMLElement>(".smith-shop-rows")!;
  const back = dialog.querySelector<HTMLButtonElement>(".window-back-button")!;
  let busy = false;
  const buttons: HTMLButtonElement[] = [];

  for (const choice of STARTER_WEAPON_CHOICES) {
    const row = document.createElement("article");
    row.className = "smith-shop-row starter-chest-card";
    row.setAttribute("role", "listitem");
    row.dataset.kind = choice.kind;
    row.innerHTML = `<span class="smith-shop-art" aria-hidden="true">${itemArtMarkup(starterWeaponId(choice.kind))}</span>`
      + `<span class="smith-shop-copy"><strong></strong><span class="smith-shop-grade"></span><span class="smith-shop-stat"></span></span>`
      + `<div class="smith-shop-deal"><div class="smith-offer"><span class="smith-offer-terms"></span></div></div>`;
    row.querySelector("strong")!.textContent = choice.name;
    row.querySelector(".smith-shop-grade")!.textContent = WEAPON_SCHOOL_NAMES[choice.school];
    row.querySelector(".smith-shop-stat")!.textContent = choice.text;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "farm-start smith-refine smith-shop-buy starter-chest-pick";
    button.textContent = "Pick";
    button.setAttribute("aria-label", `Pick the ${choice.name}`);
    button.addEventListener("click", () => void pick(choice.kind, choice.name, WEAPON_SCHOOL_NAMES[choice.school]));
    row.querySelector(".smith-offer")!.append(button);
    buttons.push(button);
    rows.append(row);
  }

  const setBusy = (value: boolean) => { busy = value; for (const button of buttons) button.disabled = value; };

  async function pick(kind: StarterWeaponKind, name: string, school: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await deps.choose(kind);
      if (result?.ok) {
        close();
        deps.showMessage(`The ${name} is yours. Every kill trains ${school}.`, "#ffffff");
      } else deps.showMessage(result?.error || "The chest would not open. Try again.", "#ffbc91");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (!dialog.open) return false;
    dialog.close();
    deps.clearInput?.();
    return true;
  }

  function open() {
    if (dialog.open) return;
    deps.clearInput?.();
    setBusy(false);
    dialog.showModal();
    back.focus();
  }

  back.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  return { open, close, isOpen: () => dialog.open, destroy() { close(); dialog.remove(); } };
}

/**
 * The chest as main.ts uses it, checked each frame: shown while the account's chest waits, a one-time hint on the
 * first visit, and the window opening as the player's feet reach the chest, as the Town's stations do.
 */
export function createStarterChestRuntime(deps: {
  coop: () => { starterChestWaiting?: () => boolean; claimStarterWeapon?: (kind: StarterWeaponKind) => Promise<Result> } | null | undefined;
  player: { x: number; y: number };
  /** In the forest, not mid-travel. */
  inForest: () => boolean;
  showMessage: (text: string, color: string) => void;
  clearInput?: () => void;
}) {
  const chest = createStarterChestWindow({
    choose: async kind => deps.coop()?.claimStarterWeapon?.(kind) ?? { ok: false, error: "Not Connected" },
    showMessage: deps.showMessage, clearInput: deps.clearInput,
  });
  let touching = false, hinted = false;
  function update() {
    const waiting = Boolean(deps.coop()?.starterChestWaiting?.());
    starterChestScene.waiting = waiting;
    const here = waiting && deps.inForest();
    if (here && !hinted) {
      hinted = true;
      deps.showMessage("A Starter Chest waits by the path. Walk up to it to pick your first weapon.", "#ffffff");
    }
    const atChest = here && Math.hypot(deps.player.x - STARTER_CHEST_POSITION.x, deps.player.y + TOWN_FEET_OFFSET - STARTER_CHEST_POSITION.y) < STARTER_CHEST_REACH;
    if (atChest && !touching) chest.open();
    touching = atChest;
    // Opened from another tab, or walked away from: the window has nothing left to offer.
    closeStationsOutOfReach(deps.player, here, [[chest, STARTER_CHEST_POSITION, STARTER_CHEST_SERVER_REACH]]);
  }
  return { update, close: chest.close, isOpen: chest.isOpen };
}
