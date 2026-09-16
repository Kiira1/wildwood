import { expect, it } from "vitest";
import { createChatViewport } from "./chat-viewport";
const rows = (start: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: BigInt(start + i) }));

it("bounds mounted rows through a long history and reaches both ends", () => {
  const view = createChatViewport();
  view.select(rows(1, 500), 360);
  for (let top = 0; top < 50_000; top += 137) {
    const range = view.window(top, 800);
    expect(range.end - range.start).toBeLessThanOrEqual(22);
    expect(range.top + range.bottom + (range.end - range.start) * 100).toBe(50_000);
  }
  expect(view.window(0, 600).start).toBe(0);
  expect(view.window(0, 600, true).end).toBe(500);
  expect(view.window(0, 20_000).end).toBeLessThanOrEqual(60);
});
it("preserves a message's pixel offset through prepends and height corrections", () => {
  const view = createChatViewport();
  view.select(rows(101, 50), 360);
  view.window(125, 600);
  const anchor = view.anchor(125);
  expect(anchor).toEqual({ id: 102n, offset: 25 });
  view.select(rows(51, 100), 360);
  const top = view.restore(anchor, 0);
  expect(top).toBe(5125);
  const range = view.window(top, 600);
  expect(range.start).toBeLessThan(51);
  expect(range.end).toBeGreaterThan(51);
  view.measure([{ id: 100n, height: 175 }, { id: 101n, height: 240 }]);
  expect(view.restore(anchor, 0)).toBe(5340);
  expect(view.anchor(5340)).toEqual(anchor);
});
it("invalidates wrapping measurements on resize and forgets evicted history", () => {
  const view = createChatViewport();
  view.select(rows(1, 100), 360);
  view.window(0, 600);
  view.measure([{ id: 1n, height: 500 }]);
  expect(view.restore({ id: 2n, offset: 0 }, 0)).toBe(500);
  view.select(rows(1, 100), 800);
  expect(view.restore({ id: 2n, offset: 0 }, 0)).toBe(100);
  view.measure([{ id: 1n, height: 500 }]);
  view.select(rows(51, 50), 800);
  view.select(rows(1, 100), 800);
  expect(view.restore({ id: 2n, offset: 0 }, 0)).toBe(100);
  view.reset(); view.select(rows(501, 50), 800);
  expect(view.restore({ id: 2n, offset: 0 }, 123)).toBe(123);
});
it("handles empty conversations and jumps to arbitrary cached messages", () => {
  const view = createChatViewport();
  view.select([], 360);
  expect(view.window(0, 600)).toEqual({ start: 0, end: 0, top: 0, bottom: 0 });
  expect(view.anchor(0).id).toBeUndefined();
  view.select(rows(1, 500), 360);
  view.window(49_000, 600);
  expect(view.needsRender(0, 600)).toBe(true);
  const top = view.restore({ id: 250n, offset: 0 }, 0);
  const range = view.window(top, 600);
  expect(range.start).toBeLessThanOrEqual(249);
  expect(range.end).toBeGreaterThan(249);
});

it("uses the existing overscan through small scrolls and refills before visible rows run out", () => {
  const view = createChatViewport();
  view.select(rows(1, 500), 360);
  view.window(10_000, 600);
  for (const delta of [-300, -100, 0, 100, 300]) expect(view.needsRender(10_000 + delta, 600)).toBe(false);
  expect(view.needsRender(9_500, 600)).toBe(true);
  expect(view.needsRender(10_500, 600)).toBe(true);
  expect(view.needsRender(40_000, 600)).toBe(true);
  view.window(0, 600);
  expect(view.needsRender(0, 600)).toBe(false);
  view.window(0, 600, true);
  expect(view.needsRender(49_400, 600)).toBe(false);
});
