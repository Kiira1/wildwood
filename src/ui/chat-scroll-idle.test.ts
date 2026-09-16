import { afterEach, expect, it, vi } from "vitest";
import { createChatScrollIdle } from "./chat-scroll-idle";

afterEach(() => vi.useRealTimers());

it("waits through a held touch and momentum before applying a loaded page", async () => {
  vi.useFakeTimers();
  const idle = createChatScrollIdle(), apply = vi.fn();
  idle.touchStart();
  const pending = idle.wait().then(apply);
  await vi.advanceTimersByTimeAsync(1000);
  expect(apply).not.toHaveBeenCalled();
  idle.touchEnd();
  await vi.advanceTimersByTimeAsync(100);
  idle.activity();
  await vi.advanceTimersByTimeAsync(159);
  expect(apply).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(apply).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not delay a slow response after scrolling stops and releases waiters on close", async () => {
  vi.useFakeTimers();
  const idle = createChatScrollIdle();
  idle.activity();
  await vi.advanceTimersByTimeAsync(200);
  await idle.wait();
  idle.touchStart();
  const apply = vi.fn(), pending = idle.wait().then(apply);
  idle.reset();
  await pending;
  expect(apply).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
