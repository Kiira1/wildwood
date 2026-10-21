import { afterEach, expect, it } from "vitest";
import { resetCameraZoomPreference } from "./camera-zoom-preference";

// The levels on screen are checked by the town scene (tools/visual-check); what is remembered stays here.
afterEach(resetCameraZoomPreference);

it("starts at 100% when nothing is saved, not at the 50% end", async () => {
  const store = new Map<string, string>();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } as Storage;
  try {
    const { vi } = await import("vitest");
    vi.resetModules();
    const fresh = await import("./camera-zoom-preference");
    expect(fresh.cameraZoomPreference()).toBe(1);
  } finally { globalThis.localStorage = previous; }
});

it("keeps a zoom saved before the wider range, and remembers the new one as a percentage", async () => {
  const store = new Map<string, string>();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } as Storage;
  try {
    const { vi } = await import("vitest");
    // Step 12 of the old 70%-130% range was 130%.
    store.set("wildstat.cameraZoomStep", "12");
    vi.resetModules();
    const old = await import("./camera-zoom-preference");
    expect(old.cameraZoomPreference()).toBe(1.3);
    old.stepCameraZoom(1);
    expect(store.get("wildstat.cameraZoomPercent")).toBe("135");
    vi.resetModules();
    expect((await import("./camera-zoom-preference")).cameraZoomPreference()).toBe(1.35);
  } finally { globalThis.localStorage = previous; }
});
