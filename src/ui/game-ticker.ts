import { GAME_TIPS, pickGameTip } from "./game-tips";
import { renderBooleanSetting } from "./settings";

const STORAGE_KEY = "wildstat-game-ticker-enabled-v1";
const PIXELS_PER_SECOND = 45;
export const GAME_TICKER_INTERVAL_MS = 10 * 60_000;

/** One compositor animation per message; no game-frame work or layout changes. */
export function installGameTicker(panel: HTMLElement, storage?: Pick<Storage, "getItem" | "setItem">) {
  const doc = panel.ownerDocument, win = doc.defaultView!;
  const button = doc.getElementById("gameTickerToggle");
  const ticker = doc.createElement("div"), text = doc.createElement("span");
  ticker.className = "game-ticker";
  ticker.setAttribute("aria-hidden", "true");
  text.className = "game-ticker-text";
  ticker.append(text);
  panel.append(ticker);
  let enabled = true, previous = -1, active = false, queued = false, disposed = false;
  let nextMessageAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { enabled = storage?.getItem(STORAGE_KEY) !== "false"; } catch {}
  function available() { return !disposed && enabled && !doc.hidden && !panel.hidden && !panel.classList.contains("is-large"); }
  function start() {
    queued = false;
    if (!available()) return;
    active = true;
    nextMessageAt = Date.now() + GAME_TICKER_INTERVAL_MS;
    ticker.hidden = false;
    previous = pickGameTip(previous);
    text.textContent = GAME_TIPS[previous];
    text.style.animation = "none";
    // Layout is measured once per tip, never during scrolling.
    const distance = win.innerWidth + text.offsetWidth;
    text.style.setProperty("--ticker-duration", `${Math.max(12, distance / PIXELS_PER_SECOND)}s`);
    void text.offsetWidth;
    text.style.animation = "";
  }
  function refresh() {
    clearTimeout(timer);
    if (!available()) { ticker.hidden = true; active = false; text.style.animation = "none"; return; }
    if (active) return;
    ticker.hidden = true;
    const remaining = nextMessageAt - Date.now();
    if (remaining > 0) { timer = setTimeout(refresh, remaining); return; }
    if (!queued) { queued = true; win.requestAnimationFrame(start); }
  }
  text.addEventListener("animationend", () => { active = false; refresh(); });
  const toggle = () => {
    enabled = !enabled;
    try { storage?.setItem(STORAGE_KEY, String(enabled)); } catch {}
    if (button) renderBooleanSetting(button, enabled);
    refresh();
  };
  button?.addEventListener("click", toggle);
  if (button) renderBooleanSetting(button, enabled);
  const observer = new win.MutationObserver(refresh);
  observer.observe(panel, { attributes: true, attributeFilter: ["hidden", "class"] });
  doc.addEventListener("visibilitychange", refresh);
  const resize = () => { active = false; refresh(); };
  win.addEventListener("resize", resize);
  refresh();
  return { dispose() { disposed = true; clearTimeout(timer); observer.disconnect(); button?.removeEventListener("click", toggle); doc.removeEventListener("visibilitychange", refresh); win.removeEventListener("resize", resize); ticker.remove(); } };
}
