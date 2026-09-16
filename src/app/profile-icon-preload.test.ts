import { afterEach, expect, it, vi } from "vitest";
import { createProfileIconPreloader } from "./profile-icon-preload";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  vi.useFakeTimers();
  const images: FakeImage[] = [];
  class FakeImage {
    src = ""; onload: (() => void) | null = null; onerror: (() => void) | null = null;
    decode = vi.fn(async () => {});
    constructor() { images.push(this); }
  }
  vi.stubGlobal("Image", FakeImage);
  return { images, load: createProfileIconPreloader() };
}
it("shares in-flight sheets, waits for decode, and reuses all three sheets", async () => {
  const f = setup(), ready = vi.fn();
  const first = f.load([0, 1, 64, 128]).then(ready);
  const second = f.load([3, 70, 191]);
  expect(f.images).toHaveLength(3);
  expect(ready).not.toHaveBeenCalled();
  for (const image of f.images) image.onload!();
  await Promise.all([first, second]);
  expect(ready).toHaveBeenCalledOnce();
  expect(f.images.every(image => image.decode.mock.calls.length === 1)).toBe(true);
  await f.load([4, 84, 132]);
  expect(f.images).toHaveLength(3);
  expect(vi.getTimerCount()).toBe(0);
});
it("retries errors and bounds slow image waits", async () => {
  const f = setup();
  const first = f.load([0]); f.images[0].onerror!(); await first;
  const slow = f.load([0]); expect(f.images).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1500); await slow;
  const retry = f.load([0]); f.images[2].onload!(); await retry;
  expect(vi.getTimerCount()).toBe(0);
});
