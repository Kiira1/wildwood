import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import type { NativeUpdateState } from "./native-updates";

const recorded: { kind: string; detail?: string }[] = [];
let active = true;
vi.mock("../coop/services/connection-diagnostic-runtime", () => ({
  recordConnectionDiagnostic: (kind: string, data: { detail?: string }) => { recorded.push({ kind, detail: data.detail }); },
  connectionDiagnosticsActive: () => active,
}));
const { installAppUpdateNotice, updateWaiting } = await import("./app-update-notice");

afterEach(() => { vi.unstubAllGlobals(); recorded.length = 0; active = true; });

function phone(initial: Partial<NativeUpdateState>, applyNow?: () => Promise<void>) {
  const { document, window } = parseHTML("<html><body></body></html>");
  let state: NativeUpdateState = { channel: "production", current: "Installed app", pending: null, message: "Updates apply on the next app launch.", busy: false, developer: false, ...initial };
  vi.stubGlobal("window", window);
  (window as unknown as { wildstatUpdates: unknown }).wildstatUpdates = { snapshot: () => state, applyNow };
  vi.stubGlobal("document", document);
  installAppUpdateNotice(document as unknown as Document);
  return {
    banner: () => document.getElementById("appUpdateReadyBanner") as HTMLElement | null,
    set(next: Partial<NativeUpdateState>) { state = { ...state, ...next }; window.dispatchEvent(new window.Event("wildstat:ota-changed")); },
  };
}

it("tells the player a downloaded update waits for a restart, until they dismiss that one", () => {
  const app = phone({});
  expect(app.banner()).toBeNull();
  app.set({ pending: "android-0.909.0-abc", message: "Ready. Fully close and reopen WildStat to apply." });
  expect(app.banner()!.hidden).toBe(false);
  expect(app.banner()!.textContent).toContain("Update ready · Close and reopen WildStat");
  (app.banner()!.querySelector("button") as HTMLButtonElement).click();
  expect(app.banner()!.hidden).toBe(true);
  // A newer update shows again.
  app.set({ pending: "android-0.909.1-def" });
  expect(app.banner()!.hidden).toBe(false);
  // Going back to the installed app, or the developer channel, is not news to announce.
  app.set({ pending: "Installed app" });
  expect(app.banner()!.hidden).toBe(true);
  expect(updateWaiting({ channel: "developer", pending: "android-x" })).toBe(false);
});

it("reports the updater's state to the server once per change, after diagnostics can carry it", () => {
  active = false;
  const app = phone({ current: "android-0.908.5-x" });
  expect(recorded).toEqual([]);
  active = true;
  app.set({ message: "Recovered to the installed app after an update failed to start.", current: "Installed app" });
  app.set({});
  expect(recorded).toHaveLength(1);
  expect(recorded[0].kind).toBe("app-update");
  expect(recorded[0].detail).toBe("current=Installed app pending=none channel=production message=Recovered to the installed app after an update failed to start.");
  // Nothing while the updater is mid-download.
  app.set({ busy: true, message: "Downloading update…" });
  expect(recorded).toHaveLength(1);
});

it("restarts into the update in one tap where the updater can, instead of asking for a close and reopen", () => {
  const applyNow = vi.fn(async () => {});
  const app = phone({}, applyNow);
  app.set({ pending: "android-0.914.5-b" });
  expect(app.banner()!.textContent).toContain("Update Ready");
  const [restart, later] = [...app.banner()!.querySelectorAll("button")] as HTMLButtonElement[];
  expect([restart.textContent, later.textContent]).toEqual(["Restart", "Later"]);
  restart.click();
  expect(applyNow).toHaveBeenCalledOnce();
  later.click();
  expect(app.banner()!.hidden).toBe(true);
});
