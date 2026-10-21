import { formatServerBoostClock } from "../../shared/server-boost";

/** "2x Rewards 14:32" at the top of the timer column under the minimap while a Server Boost runs. */
export function installServerBoostHud(remainingMs: () => number) {
  let chip: HTMLElement | null = null;
  let shown = "";
  function render() {
    if (!chip?.isConnected) {
      const column = document.querySelector(".hud-timer-column");
      if (!column) return;
      chip = document.createElement("div");
      chip.className = "hud-progress-timer hud-server-boost";
      chip.setAttribute("role", "timer");
      chip.hidden = true;
      column.prepend(chip);
      shown = "";
    }
    const left = remainingMs();
    const text = left > 0 ? formatServerBoostClock(left) : "";
    if (text === shown) return;
    shown = text;
    chip.hidden = !text;
    if (!text) return;
    const label = document.createElement("strong");
    label.textContent = "2x Rewards";
    chip.replaceChildren(label, ` ${text}`);
    chip.setAttribute("aria-label", `Server Boost: 2x Rewards, ${text} left`);
  }
  render();
  window.setInterval(() => { if (!document.hidden) render(); }, 1_000);
}
