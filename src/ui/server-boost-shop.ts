import { formatServerBoostClock, formatServerBoostWait } from "../../shared/server-boost";
import { isDeveloperIdentity } from "../../shared/developer-identity";

export type ServerBoostShopActions = {
  serverBoost?: () => { remainingMs: number; supporterName: string; cooldownMs: number };
  triggerServerBoost?: () => Promise<{ ok: boolean; error?: string }>;
  supporterTier?: () => string;
  localIdentity?: () => string | undefined;
};

/** The Shop's Server Boost row: what it does, whether one runs, and the supporter's Start button with its wait. */
export function createServerBoostShopRow(actions: ServerBoostShopActions) {
  const row = document.createElement("section");
  row.className = "shop-server-boost";
  row.setAttribute("aria-labelledby", "shopServerBoostTitle");
  row.innerHTML = '<h2 id="shopServerBoostTitle">Server Boost</h2>'
    + "<p>2x Rewards for everyone online for 15 minutes. Patreon supporters can start one once a day.</p>"
    + '<p class="shop-server-boost-live" role="status"></p>'
    + '<button class="shop-server-boost-start" type="button">Start Server Boost</button>'
    + '<p class="shop-server-boost-note" role="status"></p>';
  const live = row.querySelector<HTMLElement>(".shop-server-boost-live")!;
  const start = row.querySelector<HTMLButtonElement>(".shop-server-boost-start")!;
  const note = row.querySelector<HTMLElement>(".shop-server-boost-note")!;
  let busy = false, error = "";
  const supporter = () => (actions.supporterTier?.() ?? "none") !== "none" || isDeveloperIdentity(actions.localIdentity?.());

  function render() {
    const state = actions.serverBoost?.() ?? { remainingMs: 0, supporterName: "", cooldownMs: 0 };
    live.textContent = state.remainingMs > 0
      ? `Running: ${formatServerBoostClock(state.remainingMs)} left, thanks to ${state.supporterName}` : "";
    const canStart = supporter();
    start.hidden = !canStart;
    start.disabled = busy || state.cooldownMs > 0;
    start.textContent = state.remainingMs > 0 ? "Add 15 Minutes" : "Start Server Boost";
    note.textContent = error || (!canStart ? "A Patreon supporter perk." : state.cooldownMs > 0
      ? `Your next Server Boost is ready in ${formatServerBoostWait(state.cooldownMs)}.` : "");
  }

  start.addEventListener("click", async () => {
    if (busy || !actions.triggerServerBoost) return;
    busy = true; error = ""; render();
    const result = await actions.triggerServerBoost();
    busy = false;
    error = result.ok ? "" : result.error || "Could not start the Server Boost. Try again.";
    render();
  });
  render();
  window.setInterval(() => { if (row.closest("dialog")?.open) render(); }, 1_000);
  return row;
}
