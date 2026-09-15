import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { installKeepScreenOnSettings } from "./keep-screen-on-settings";
import { SCREEN_ACTIVITY_EVENT } from "../app/screen-wake-lock";

afterEach(() => vi.unstubAllGlobals());
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fixture(saved = new Map<string, string>(), supported = true) {
  const { document, window } = parseHTML('<html><body><button id="keepScreenOnToggle"></button></body></html>');
  const release = vi.fn(async () => {});
  const bridge = { active: true, request: vi.fn(async () => ({ release })) };
  const win = { navigator: {}, wildstatScreenWakeLock: supported ? bridge : undefined,
    addEventListener: window.addEventListener.bind(window) } as unknown as Window;
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  installKeepScreenOnSettings(document, win, storage, vi.fn());
  return { document, window, bridge, release, button: document.getElementById("keepScreenOnToggle")! };
}

it("saves the preference and responds to native foreground/background events", async () => {
  const saved = new Map<string, string>();
  const f = fixture(saved);
  expect(f.button.textContent).toBe("OFF");
  f.button.click(); await settle();
  expect(f.button.getAttribute("aria-pressed")).toBe("true");
  expect(f.bridge.request).toHaveBeenCalledOnce();
  f.bridge.active = false;
  f.window.dispatchEvent(new f.window.Event(SCREEN_ACTIVITY_EVENT)); await settle();
  expect(f.release).toHaveBeenCalledOnce();
  f.bridge.active = true;
  f.window.dispatchEvent(new f.window.Event(SCREEN_ACTIVITY_EVENT)); await settle();
  expect(f.bridge.request).toHaveBeenCalledTimes(2);
  const restored = fixture(saved); await settle();
  expect(restored.button.textContent).toBe("ON");
  expect(restored.bridge.request).toHaveBeenCalledOnce();
});

it("clearly disables unsupported devices", () => {
  const f = fixture(new Map(), false);
  expect((f.button as HTMLButtonElement).disabled).toBe(true);
  expect(f.button.textContent).toBe("Unavailable");
});
