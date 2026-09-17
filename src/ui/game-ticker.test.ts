import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { GAME_TICKER_INTERVAL_MS, installGameTicker } from "./game-ticker";
import { GAME_TIPS, pickGameTip } from "./game-tips";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("chooses a different random tip after each full pass", () => {
  for (let previous = 0; previous < GAME_TIPS.length; previous++) {
    for (const random of [0, .5, .999999]) {
      const next = pickGameTip(previous, () => random);
      expect(next).not.toBe(previous);
      expect(GAME_TIPS[next]).toBeTruthy();
    }
  }
});
it("persists the toggle, pauses when hidden, and doesn't rearrange chat", async () => {
  vi.useFakeTimers();
  const { document, window } = parseHTML('<html><body><button id="gameTickerToggle"></button><div id="chatPanel"><div id="messages">Chat stays here</div></div></body></html>');
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
  const storage = { getItem: () => "false", setItem: vi.fn() };
  const panel = document.getElementById("chatPanel")!;
  const original = panel.firstElementChild;
  const controller = installGameTicker(panel, storage);
  const ticker = panel.querySelector<HTMLElement>(".game-ticker")!;
  const text = ticker.firstElementChild!;
  const button = document.getElementById("gameTickerToggle")!;
  expect(ticker.hidden).toBe(true);
  button.click();
  expect(ticker.hidden).toBe(false);
  expect(storage.setItem).toHaveBeenLastCalledWith("wildstat-game-ticker-enabled-v1", "true");
  expect(GAME_TIPS).toContain(text.textContent);
  const previous = text.textContent;
  text.dispatchEvent(new window.Event("animationend"));
  expect(text.textContent).toBe(previous);
  expect(ticker.hidden).toBe(true);
  vi.advanceTimersByTime(GAME_TICKER_INTERVAL_MS - 1);
  expect(ticker.hidden).toBe(true);
  vi.advanceTimersByTime(1);
  expect(ticker.hidden).toBe(false);
  expect(text.textContent).not.toBe(previous);
  panel.classList.add("is-large");
  await Promise.resolve();
  expect(ticker.hidden).toBe(true);
  panel.classList.remove("is-large");
  await Promise.resolve();
  expect(ticker.hidden).toBe(true);
  // Opening chat or toggling the setting cannot bypass the spacing.
  button.click(); button.click();
  expect(ticker.hidden).toBe(true);
  vi.advanceTimersByTime(GAME_TICKER_INTERVAL_MS);
  expect(ticker.hidden).toBe(false);
  expect(panel.firstElementChild).toBe(original);
  controller.dispose();
  expect(panel.children.length).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("updates a running supporter tip on membership changes without adding another ticker", () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(.99999);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
  const { document, window } = parseHTML('<html><body><div id="chatPanel"></div></body></html>');
  let names = ["First"];
  const panel = document.getElementById("chatPanel")!;
  const controller = installGameTicker(panel, undefined, () => names);
  const text = panel.querySelector(".game-ticker-text")!;
  expect(text.textContent).toContain("First");
  names = Array.from({ length: 30 }, (_, i) => `Supporter ${i}`);
  window.dispatchEvent(new window.Event("wildstat:patreon-ticker-changed"));
  expect(text.textContent).toContain(names.join(", "));
  names = [];
  window.dispatchEvent(new window.Event("wildstat:patreon-ticker-changed"));
  expect(panel.querySelector<HTMLElement>(".game-ticker")!.hidden).toBe(true);
  expect(panel.querySelectorAll(".game-ticker")).toHaveLength(1);
  controller.dispose();
});
