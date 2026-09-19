/** The windows that close each other: opening one closes every other. */
export type CompetingPanel = "techTree" | "guild" | "leaderboard" | "devPanel" | "upgradeBench" | "mapGuide";

/**
 * Panels are constructed across a wide span of the composition root and several
 * are forward-declared, so every handle arrives as a getter and is read at call
 * time rather than captured here.
 */
export function createPanelCoordinator(deps: {
  guild: () => { close: () => void } | undefined;
  mapGuide: () => { close: () => void } | undefined;
  upgradeBench: () => { close: () => void } | undefined;
  techTree: () => { close: () => void };
  devPanel: () => { close: () => void };
  closeLeaderboard: () => void;
  itemInspection: { close: () => void };
  minimizeMaximizedChat: () => void;
  settingsPanel: HTMLElement;
  inventoryPanel: HTMLElement;
  settingsBtn: HTMLElement;
  inventoryBtn: HTMLElement;
}) {
  return {
    /**
     * Closes the same set each caller closed inline before: every competing
     * window but the one being opened. Callers keep their own extra steps,
     * such as pausing gameplay, at their own call site.
     */
    closeAllExcept(opening: CompetingPanel) {
      if (opening !== "guild") deps.guild()?.close();
      if (opening !== "mapGuide") deps.mapGuide()?.close();
      deps.minimizeMaximizedChat();
      deps.itemInspection.close();
      if (opening !== "upgradeBench") deps.upgradeBench()?.close();
      deps.settingsPanel.hidden = true;
      deps.inventoryPanel.hidden = true;
      deps.settingsBtn.setAttribute("aria-expanded", "false");
      deps.inventoryBtn.setAttribute("aria-expanded", "false");
      if (opening !== "leaderboard") deps.closeLeaderboard();
      if (opening !== "devPanel") deps.devPanel().close();
      if (opening !== "techTree") deps.techTree().close();
    },
  };
}
