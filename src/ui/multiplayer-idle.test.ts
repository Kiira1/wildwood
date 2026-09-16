import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { installMultiplayerIdle, MULTIPLAYER_IDLE_MS } from "./multiplayer-idle";

afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  const { document, window } = parseHTML('<html><body></body></html>');
  const expire = vi.fn();
  const idle = installMultiplayerIdle(document, expire);
  function input(type: string, props = {}) {
    const event = new window.Event(type);
    Object.defineProperty(event, "isTrusted", { value: true });
    Object.assign(event, props);
    document.dispatchEvent(event);
  }
  idle.setEnabled(true);
  return { idle, expire, input, document };
}
it("expires once after five minutes and stays off until manually enabled", () => {
  const s = setup();
  vi.advanceTimersByTime(MULTIPLAYER_IDLE_MS - 1);
  expect(s.expire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(s.expire).toHaveBeenCalledOnce();
  s.input("pointermove");
  vi.advanceTimersByTime(MULTIPLAYER_IDLE_MS * 2);
  expect(s.expire).toHaveBeenCalledOnce();
  s.idle.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
it("renews on real input, but not synthetic activity or autofarm events", () => {
  const s = setup();
  vi.advanceTimersByTime(240_000);
  s.input("wheel");
  vi.advanceTimersByTime(240_000);
  expect(s.expire).not.toHaveBeenCalled();
  s.document.dispatchEvent(new s.document.defaultView!.Event("pointermove"));
  vi.advanceTimersByTime(60_000);
  expect(s.expire).toHaveBeenCalledOnce();
  s.idle.dispose();
});
it("keeps held movement active and clears held input on backgrounding", () => {
  const s = setup();
  s.input("pointerdown", { pointerId: 1 });
  vi.advanceTimersByTime(MULTIPLAYER_IDLE_MS * 2);
  expect(s.expire).not.toHaveBeenCalled();
  Object.defineProperty(s.document, "hidden", { value: true, configurable: true });
  s.document.dispatchEvent(new s.document.defaultView!.Event("visibilitychange"));
  vi.advanceTimersByTime(MULTIPLAYER_IDLE_MS);
  expect(s.expire).toHaveBeenCalledOnce();
  s.idle.dispose();
});
it("checks overdue background timers before a return can renew them", () => {
  const s = setup();
  vi.setSystemTime(Date.now() + MULTIPLAYER_IDLE_MS + 1);
  s.input("pointerdown", { pointerId: 1 });
  expect(s.expire).toHaveBeenCalledOnce();
  s.idle.dispose();
});
