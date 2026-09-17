import { installMultiplayerIdle } from "./multiplayer-idle";

const STORAGE_KEY = "wildstat-show-other-players";
const COOLDOWN_MS = 20_000;

/** Mutual multiplayer participation, with manual movement waking it after idle. */
export function createPlayerVisibilityToggle(options: {
  button: HTMLButtonElement;
  setVisible: (visible: boolean) => void;
  storage?: Pick<Storage, "getItem" | "setItem">;
}) {
  let visible = false;
  let cooldownUntil = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { visible = options.storage?.getItem(STORAGE_KEY) === "true"; } catch { /* Storage may be unavailable. */ }
  options.button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="player-visibility-slash" d="m4 3 16 18"/></svg><span class="player-visibility-countdown" aria-hidden="true"></span>`;
  const countdown = options.button.querySelector<HTMLElement>(".player-visibility-countdown")!;
  const idle = installMultiplayerIdle(options.button.ownerDocument, () => {
    visible = false;
    try { options.storage?.setItem(STORAGE_KEY, "false"); } catch {}
    refresh();
    options.setVisible(false);
  });
  function refresh() {
    clearTimeout(timer);
    const seconds = Math.max(0, Math.ceil((cooldownUntil - performance.now()) / 1000));
    options.button.disabled = seconds > 0;
    countdown.textContent = seconds ? String(seconds) : "";
    options.button.setAttribute("aria-pressed", String(visible));
    const action = visible ? "Turn multiplayer off" : "Turn multiplayer on";
    const label = seconds ? `${action} — available in ${seconds} seconds` : action;
    options.button.setAttribute("aria-label", label);
    options.button.title = label;
    if (seconds) timer = setTimeout(refresh, Math.min(1000, cooldownUntil - performance.now()));
  }
  const click = () => {
    if (performance.now() < cooldownUntil) return;
    visible = !visible;
    idle.setEnabled(visible);
    cooldownUntil = performance.now() + COOLDOWN_MS;
    try { options.storage?.setItem(STORAGE_KEY, String(visible)); } catch { /* Keep the session preference. */ }
    refresh();
    options.setVisible(visible);
  };
  options.button.addEventListener("click", click);
  refresh();
  options.setVisible(visible);
  idle.setEnabled(visible);
  return { noteManualMovement() {
    if (options.button.ownerDocument.hidden) return;
    if (!visible) {
      // Honor a deliberate toggle's cooldown; an idle expiration has no new
      // cooldown, so actual movement can immediately restore multiplayer.
      if (performance.now() < cooldownUntil) return;
      visible = true;
      idle.setEnabled(true);
      cooldownUntil = performance.now() + COOLDOWN_MS;
      try { options.storage?.setItem(STORAGE_KEY, "true"); } catch {}
      refresh(); options.setVisible(true);
    } else idle.noteManualMovement();
  }, dispose() { idle.dispose(); clearTimeout(timer); options.button.removeEventListener("click", click); } };
}
