import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createPlayerVisibilityToggle } from "./player-visibility-toggle";

afterEach(() => vi.useRealTimers());
function setup(saved: string | null = null) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
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
