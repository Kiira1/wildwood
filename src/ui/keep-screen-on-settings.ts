import { createScreenWakeLock, SCREEN_ACTIVITY_EVENT, type NativeScreenWakeLock } from "../app/screen-wake-lock";
import { renderBooleanSetting } from "./settings";

const STORAGE_KEY = "wildstat-keep-screen-on-v1";

export function installKeepScreenOnSettings(doc: Document, win: Window, storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  showMessage: (message: string, color: string) => void) {
  const button = doc.getElementById("keepScreenOnToggle") as HTMLButtonElement;
  const native = (win as Window & { wildstatScreenWakeLock?: NativeScreenWakeLock }).wildstatScreenWakeLock;
  const web = win.navigator.wakeLock;
  let enabled = false;
  try { enabled = storage?.getItem(STORAGE_KEY) === "true"; } catch {}
  renderBooleanSetting(button, enabled);
  if (!native && !web?.request) {
    button.disabled = true;
    button.textContent = "Unavailable";
    button.title = "Keep screen on is unavailable on this device.";
    return;
  }
  let userRequested = false;
  let pageActive = true;
  const controller = createScreenWakeLock(
    () => native ? native.request() : web.request("screen"),
    (active, failed) => {
      button.title = enabled && !active ? "Waiting for the device to allow screen lock." : "Keep screen on";
      if (failed && enabled && userRequested) showMessage("KEEP SCREEN ON UNAVAILABLE RIGHT NOW", "#ff9b91");
      userRequested = false;
    },
  );
  const refresh = () => { void controller.setVisible(pageActive && !doc.hidden && (native?.active ?? true)); };
  button.addEventListener("click", () => {
    enabled = !enabled;
    userRequested = enabled;
    try { storage?.setItem(STORAGE_KEY, String(enabled)); } catch {}
    renderBooleanSetting(button, enabled);
    void controller.setEnabled(enabled);
  });
  doc.addEventListener("visibilitychange", refresh);
  win.addEventListener(SCREEN_ACTIVITY_EVENT, refresh);
  win.addEventListener("pagehide", () => { pageActive = false; refresh(); });
  win.addEventListener("pageshow", () => { pageActive = true; refresh(); });
  // A platform may require interaction or have released the lock to save power.
  doc.addEventListener("pointerdown", () => { void controller.retry(); });
  doc.addEventListener("keydown", () => { void controller.retry(); });
  refresh();
  void controller.setEnabled(enabled);
}
