import { expect, it, vi } from "vitest";
import { createEnemyStatusPlates } from "./enemy-status-plate";

function fakeCanvas() {
  const calls: string[] = [];
  const context = new Proxy({ measureText: (text: string) => ({ width: text.length * 6, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 1 }) } as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => { calls.push(`${key}(${args.map(arg => typeof arg === "object" ? "canvas" : String(arg)).join(",")})`); };
    },
    set(target, key: string, value) { target[key] = value; return true; },
  });
  return { canvas: { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement, calls };
}

it("builds one plate per bar size and health state, and reuses it for every enemy with that bar", () => {
  const made: ReturnType<typeof fakeCanvas>[] = [];
  const plates = createEnemyStatusPlates({ pixelRatio: () => 2, createCanvas: () => { const canvas = fakeCanvas(); made.push(canvas); return canvas.canvas; } });
  const first = plates.plate(80, 5, true);
  for (let enemy = 0; enemy < 9; enemy++) expect(plates.plate(80, 5, true)).toBe(first);
  expect(made).toHaveLength(1);
  // The bare plate for a wounded enemy and a wider bar are separate plates.
  expect(plates.plate(80, 5, false)).not.toBe(first);
  expect(plates.plate(90, 5, true)).not.toBe(first);
  expect(made).toHaveLength(3);
  expect(plates.size()).toBe(3);
});

it("draws a pill bar with no text: outline, empty track and, at full health, the fill", () => {
  const made: ReturnType<typeof fakeCanvas>[] = [];
  const plates = createEnemyStatusPlates({ pixelRatio: () => 2, createCanvas: () => { const canvas = fakeCanvas(); made.push(canvas); return canvas.canvas; } });
  const full = plates.plate(80, 5, true);
  expect(made[0].calls.filter(call => call === "fill()")).toHaveLength(3);
  expect(made[0].calls.some(call => call.startsWith("arcTo"))).toBe(true);
  expect(made[0].calls.some(call => call.startsWith("fillText") || call.startsWith("strokeText") || call.startsWith("fillRect"))).toBe(false);
  // Drawn at the pixel ratio, so the plate lands one-to-one on the screen.
  expect(made[0].canvas.width).toBe(Math.ceil(full.width * 2));
  expect(full.top).toBeLessThan(-1);
  plates.plate(80, 5, false);
  expect(made[1].calls.filter(call => call === "fill()")).toHaveLength(2);
});

it("rebuilds for a new pixel ratio and starts over when the cache fills", () => {
  let ratio = 2;
  const create = vi.fn(() => fakeCanvas().canvas);
  const plates = createEnemyStatusPlates({ pixelRatio: () => ratio, createCanvas: create });
  ratio = 2;
  for (let width = 0; width < 600; width++) plates.plate(1_000 + width, 5, false);
  expect(plates.size()).toBeLessThanOrEqual(512);
  plates.plate(80, 5, false);
  ratio = 3;
  plates.plate(80, 5, false);
  expect(create).toHaveBeenCalledTimes(602);
});
