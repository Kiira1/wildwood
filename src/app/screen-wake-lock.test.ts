import { expect, it, vi } from "vitest";
import { createScreenWakeLock, type ScreenLock } from "./screen-wake-lock";

function fixture() {
  const locks: Array<ScreenLock & { releasedByOS: () => void }> = [];
  const request = vi.fn(async () => {
    let onRelease = () => {};
    const lock = { release: vi.fn(async () => {}), addEventListener: (_: "release", fn: () => void) => { onRelease = fn; }, releasedByOS: () => onRelease() };
    locks.push(lock);
    return lock;
  });
  const changed = vi.fn();
  const controller = createScreenWakeLock(request, changed);
  return { controller, request, changed, locks };
}

it("defaults off and releases/reacquires across background and foreground", async () => {
  const f = fixture();
  await f.controller.setVisible(true);
  expect(f.request).not.toHaveBeenCalled();
  await f.controller.setEnabled(true);
  await f.controller.retry();
  expect(f.request).toHaveBeenCalledOnce();
  await f.controller.setVisible(false);
  expect(f.locks[0].release).toHaveBeenCalledOnce();
  await f.controller.setVisible(true);
  expect(f.request).toHaveBeenCalledTimes(2);
  await f.controller.setEnabled(false);
  expect(f.locks[1].release).toHaveBeenCalledOnce();
});

it("releases a late acquisition when disabled while the request is pending", async () => {
  let resolve!: (lock: ScreenLock) => void;
  const release = vi.fn(async () => {});
  const request = vi.fn(() => new Promise<ScreenLock>(done => { resolve = done; }));
  const controller = createScreenWakeLock(request, vi.fn());
  const acquiring = controller.setEnabled(true);
  void controller.setEnabled(false);
  resolve({ release });
  await acquiring; await controller.retry();
  expect(request).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});

it("does not repeatedly request after OS release, but can retry on interaction", async () => {
  const f = fixture();
  await f.controller.setEnabled(true);
  f.locks[0].releasedByOS();
  expect(f.changed).toHaveBeenLastCalledWith(false, false);
  expect(f.request).toHaveBeenCalledOnce();
  await f.controller.retry();
  expect(f.request).toHaveBeenCalledTimes(2);
});

it("recovers from a rejected request without an unhandled rejection or retry loop", async () => {
  const f = fixture();
  f.request.mockRejectedValueOnce(new Error("Low battery"));
  await f.controller.setEnabled(true);
  expect(f.changed).toHaveBeenLastCalledWith(false, true);
  expect(f.request).toHaveBeenCalledOnce();
  await f.controller.retry();
  expect(f.changed).toHaveBeenLastCalledWith(true, false);
});

it("remembers enabled while hidden without acquiring until visible", async () => {
  const f = fixture();
  await f.controller.setVisible(false);
  await f.controller.setEnabled(true);
  expect(f.request).not.toHaveBeenCalled();
  await f.controller.setVisible(true);
  expect(f.request).toHaveBeenCalledOnce();
});
