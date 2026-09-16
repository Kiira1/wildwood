export const FULLSCREEN_MOVEMENT_DELAY_MS = 700;
const FULLSCREEN_IDS = ["inventoryPanel", "settingsPanel", "leaderboard", "guildOverlay", "gemShop", "mapGuide", "techTreeOverlay", "upgradeBenchPanel", "duelReplay"];

/** Temporary subscription suspension, independent of the saved eye preference. */
export function createFullscreenMovementGate(setVisible: (visible: boolean) => void) {
  let wanted = false, suspended = false, open = false, applied: boolean | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;
  function apply() {
    const visible = wanted && !suspended;
    if (visible === applied) return;
    applied = visible;
    setVisible(visible);
  }
  function setFullscreen(value: boolean) {
    open = value;
    if (!open || !wanted) {
      clearTimeout(timer); timer = undefined;
      suspended = false;
      apply();
    } else if (!suspended && timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        if (open && wanted) { suspended = true; apply(); }
      }, FULLSCREEN_MOVEMENT_DELAY_MS);
    }
  }
  return {
    setWanted(value: boolean) { wanted = value; setFullscreen(open); apply(); },
    setFullscreen,
    // Call after the shell, guild panel, and shop have mounted. Observe only
    // window attributes, never chat rows or the game's animation loop.
    watchWindows(doc: Document) {
      observer?.disconnect();
      const panels = FULLSCREEN_IDS.map(id => doc.getElementById(id)).filter((node): node is HTMLElement => Boolean(node));
      const chat = doc.getElementById("chatPanel");
      const refresh = () => setFullscreen(panels.some(panel => panel.tagName === "DIALOG"
        ? panel.hasAttribute("open") : !panel.hidden) || Boolean(chat && !chat.hidden && chat.classList.contains("is-large")));
      observer = new doc.defaultView!.MutationObserver(refresh);
      for (const panel of panels) observer.observe(panel, { attributes: true, attributeFilter: ["hidden", "open"] });
      if (chat) observer.observe(chat, { attributes: true, attributeFilter: ["hidden", "class"] });
      refresh();
    },
    dispose() { clearTimeout(timer); observer?.disconnect(); },
  };
}
