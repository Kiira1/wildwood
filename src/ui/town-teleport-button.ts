const TOWN_TELEPORT_COOLDOWN_MS = 5_000;
/**
 * After chat closes, the Town teleport ignores taps this long, so the tap
 * that closes chat, or the next one, cannot send a player home by accident.
 * Chat closed with the Escape key holds nothing: no tap is on its way.
 */
export const TOWN_TELEPORT_CHAT_CLOSE_HOLD_MS = 1_000;
/** Dispatched on window by chat when its expanded panel closes. */
export const CHAT_CLOSED_EVENT = "wildwood:chat-closed";

/**
 * The toolbar teleport names where it goes: the Town from anywhere else, Fight in the Town (back to the spot the
 * player left), and the Town's square from the Copper Hills or Timberwood, where a gatherer wants the shops.
 */
export function townTeleportLook(mapId: string, gathering = false) {
  const inTown = mapId === "town";
  return inTown && !gathering
    ? { label: "Fight", ariaLabel: "Return to enemy map", icon: "assets/wildstat/icons/Icon_AutoFarm.svg" }
    : { label: "Town", ariaLabel: inTown ? "Teleport to the Town square" : "Teleport to Town", icon: "assets/wildstat/icons/Icon_Home.svg" };
}

/** Paints the toolbar teleport button for the map the player is on, and where in the Town. */
export function paintTownTeleportButton(button: HTMLElement, mapId: string, gathering = false) {
  const look = townTeleportLook(mapId, gathering);
  button.setAttribute("aria-label", look.ariaLabel);
  const icon = button.querySelector<HTMLImageElement>(".toolbar-icon");
  if (icon) icon.src = look.icon;
  const label = button.querySelector(".toolbar-label");
  if (label) label.textContent = look.label;
}

export function bindTownTeleportButton(
  button: HTMLButtonElement,
  options: {
    beforeTeleport(): void;
    teleport(): Promise<boolean>;
    showFailure(failed: boolean): void;
    /** Says why a tap during the hold did nothing. */
    showBlocked?(text: string): void;
  },
) {
  const cooldown = button.ownerDocument.createElement("span");
  cooldown.className = "town-teleport-cooldown";
  cooldown.hidden = true;
  cooldown.setAttribute("aria-hidden", "true");
  button.append(cooldown);
  let heldUntil = 0, escapeAt = Number.NEGATIVE_INFINITY;
  const view = button.ownerDocument.defaultView;
  // Captured, so it is seen before the chat box's own Escape handling stops it.
  view?.addEventListener("keydown", event => { if (event.key === "Escape") escapeAt = performance.now(); }, true);
  view?.addEventListener(CHAT_CLOSED_EVENT, () => {
    if (performance.now() - escapeAt < 500) return;
    heldUntil = performance.now() + TOWN_TELEPORT_CHAT_CLOSE_HOLD_MS;
  });

  function showCooldown() {
    const endsAt = Date.now() + TOWN_TELEPORT_COOLDOWN_MS;
    cooldown.hidden = false;
    button.classList.add("is-town-cooldown");
    const update = () => {
      const remaining = Math.max(0, endsAt - Date.now());
      if (!remaining) {
        cooldown.hidden = true;
        button.classList.remove("is-town-cooldown");
        button.removeAttribute("title");
        button.disabled = false;
        return;
      }
      const seconds = Math.ceil(remaining / 1_000);
      cooldown.textContent = String(seconds);
      cooldown.style.setProperty("--cooldown-progress", `${remaining / TOWN_TELEPORT_COOLDOWN_MS * 100}%`);
      button.title = `Teleport ready in ${seconds}s`;
      setTimeout(update, Math.min(50, remaining));
    };
    update();
  }

  /** One teleport through the button: the chat hold, closing windows, the failure line and the cooldown. */
  async function go(teleport = options.teleport) {
    if (button.disabled) return;
    const held = heldUntil - performance.now();
    if (held > 0) {
      options.showBlocked?.(`TOWN READY IN ${Math.ceil(held / 1_000)}S`);
      return;
    }
    button.disabled = true;
    let changed = false;
    try {
      options.beforeTeleport();
      changed = await teleport();
      if (!changed) options.showFailure(false);
    } catch {
      options.showFailure(true);
    } finally {
      if (changed) {
        showCooldown();
      } else {
        button.disabled = false;
      }
    }
  }
  button.addEventListener("click", () => { void go(); });
  /** Can a teleport start now (not cooling down), and the same teleport to another landing. */
  return { ready: () => !button.disabled, go };
}
