/** Reserve the same two columns of five collapsed stat rows while loading. */
export function createProfileLoading(loading: HTMLElement, statGrid: HTMLElement) {
  const panels = loading.parentElement!;
  return {
    show() {
      statGrid.replaceChildren();
      for (let column = 0; column < 2; column++) {
        const group = loading.ownerDocument.createElement("dl");
        group.className = "profile-grid profile-stat-column";
        for (let row = 0; row < 5; row++) group.append(loading.ownerDocument.createElement("div"));
        statGrid.append(group);
      }
      const spinner = loading.ownerDocument.createElement("span");
      spinner.className = "profile-loading-spinner";
      spinner.setAttribute("aria-hidden", "true");
      loading.replaceChildren(spinner);
      loading.setAttribute("aria-label", "Loading player stats");
      loading.hidden = false;
      panels.classList.add("is-loading");
      panels.setAttribute("aria-busy", "true");
    },
    hide() {
      loading.hidden = true;
      panels.classList.remove("is-loading");
      panels.removeAttribute("aria-busy");
    },
    fail() {
      loading.textContent = "PLAYER DATA UNAVAILABLE";
      loading.removeAttribute("aria-label");
      panels.removeAttribute("aria-busy");
    },
  };
}
