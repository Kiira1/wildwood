import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createPlayerVisibilityToggle } from "./player-visibility-toggle";
import { createFullscreenMovementGate } from "./fullscreen-movement";

afterEach(() => vi.useRealTimers());
function setup(saved: string | null = null) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  const { document } = parseHTML('<button></button>');
  const button = document.querySelector("button") as unknown as HTMLButtonElement;
  const setVisible = vi.fn();
  const storage = { getItem: () => saved, setItem: vi.fn() };
  const toggle = createPlayerVisibilityToggle({ button, setVisible, storage });
  return { button, setVisible, storage, toggle };
}

it("starts off, is available immediately, and blocks rapid toggles for twenty seconds", () => {
  const state = setup();
  expect(state.button.disabled).toBe(false);
  expect(state.setVisible.mock.calls).toEqual([[false]]);
  state.button.click();
  expect(state.setVisible).toHaveBeenLastCalledWith(true);
  expect(state.storage.setItem).toHaveBeenLastCalledWith("wildstat-show-other-players", "true");
  expect(state.button.disabled).toBe(true);
  expect(state.button.textContent).toBe("20");
  state.button.click();
  vi.advanceTimersByTime(19_999);
  state.button.click();
  expect(state.setVisible).toHaveBeenCalledTimes(2);
  expect(state.button.disabled).toBe(true);
  vi.advanceTimersByTime(1);
  expect(state.button.disabled).toBe(false);
  expect(state.button.textContent).toBe("");
  state.button.click();
  expect(state.setVisible).toHaveBeenLastCalledWith(false);
  expect(state.button.disabled).toBe(true);
  state.toggle.dispose();
});

it("restores the saved preference without a map restriction or startup cooldown", () => {
  const state = setup("true");
  expect(state.setVisible).toHaveBeenLastCalledWith(true);
  expect(state.button.disabled).toBe(false);
  expect(state.button.getAttribute("aria-pressed")).toBe("true");
  state.button.click();
  expect(state.setVisible).toHaveBeenLastCalledWith(false);
  state.toggle.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it("turns the actual multiplayer preference off after five minutes without input", () => {
  const state = setup("true");
  vi.advanceTimersByTime(300_000);
  expect(state.setVisible).toHaveBeenLastCalledWith(false);
  expect(state.storage.setItem).toHaveBeenLastCalledWith("wildstat-show-other-players", "false");
  expect(state.button.getAttribute("aria-pressed")).toBe("false");
  expect(state.button.disabled).toBe(false);
  state.button.click();
  expect(state.setVisible).toHaveBeenLastCalledWith(true);
  expect(state.button.disabled).toBe(true);
  state.toggle.dispose();
});

it("expires while chatting, stays off when chat closes, and wakes on manual movement", () => {
  vi.useFakeTimers();
  const { document, window } = parseHTML('<button></button>');
  const button = document.querySelector("button") as unknown as HTMLButtonElement;
  const apply = vi.fn(), gate = createFullscreenMovementGate(apply);
  const toggle = createPlayerVisibilityToggle({ button, setVisible: gate.setWanted, storage: { getItem: () => "true", setItem: vi.fn() } });
  gate.setFullscreen(true);
  for (let i = 0; i < 5; i++) {
    vi.advanceTimersByTime(60_000);
    document.dispatchEvent(new window.Event("input"));
    document.dispatchEvent(new window.Event("wheel"));
  }
  expect(button.getAttribute("aria-pressed")).toBe("false");
  gate.setFullscreen(false);
  expect(apply.mock.calls).toEqual([[true], [false]]);
  toggle.noteManualMovement();
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(apply.mock.calls).toEqual([[true], [false], [true]]);
  toggle.dispose(); gate.dispose();
});

it("automatically enables once for manual movement, respects manual-off cooldown, and expires again", () => {
  const state = setup();
  state.toggle.noteManualMovement();
  expect(state.setVisible.mock.calls).toEqual([[false], [true]]);
  for (let i = 0; i < 1000; i++) state.toggle.noteManualMovement();
  expect(state.setVisible).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(20_000);
  state.button.click();
  state.toggle.noteManualMovement();
  expect(state.setVisible).toHaveBeenLastCalledWith(false);
  vi.advanceTimersByTime(20_000);
  state.toggle.noteManualMovement();
  expect(state.setVisible).toHaveBeenLastCalledWith(true);
  vi.advanceTimersByTime(300_000);
  expect(state.setVisible).toHaveBeenLastCalledWith(false);
  state.toggle.noteManualMovement();
  expect(state.setVisible).toHaveBeenLastCalledWith(true);
  state.toggle.dispose();
});
