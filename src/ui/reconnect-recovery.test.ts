import { expect, it, vi } from "vitest";
import { createReconnectRecovery } from "./reconnect-recovery";

it("offers retry immediately, then reload after 30 seconds without reloading automatically", () => {
  let now = 0;
  const retry = vi.fn(), reload = vi.fn(() => true);
  const recovery = createReconnectRecovery({ now: () => now, retry, reload });
  expect(recovery.update(true)).toBe(false);
  recovery.activate(); expect(retry).toHaveBeenCalledOnce();
  now = 30_000;
  expect(recovery.update(true)).toBe(true);
  expect(reload).not.toHaveBeenCalled();
  recovery.activate(); expect(reload).toHaveBeenCalledOnce();
  recovery.update(false);
  now += 60_000;
  expect(recovery.update(true)).toBe(false);
});

it("keeps retrying in place if the session handoff cannot be saved", () => {
  let now = 0;
  const retry = vi.fn(), reload = vi.fn(() => false);
  const recovery = createReconnectRecovery({ now: () => now, retry, reload });
  recovery.update(true); now = 40_000; recovery.update(true); recovery.activate();
  expect(retry).toHaveBeenCalledOnce();
});
