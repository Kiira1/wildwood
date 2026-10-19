import { expect, it } from "vitest";
import { TOOL_MAX_LEVEL } from "../../../../shared/tools";
import { PLAIN_STEEL } from "./pickaxe-sprite";
import { TOOL_METALS, paintFocus, paintHammer, paintKnife, toolArtSource, toolMetal } from "./tool-sprites";

/** A context that records every point drawn and every colour used. */
function recorder() {
  const xs: number[] = [], ys: number[] = [], colors = new Set<string>();
  const point = (x: number, y: number) => { xs.push(x); ys.push(y); };
  const context = {
    lineWidth: 1, lineJoin: "", lineCap: "",
    set strokeStyle(value: string) { colors.add(value); }, set fillStyle(value: string) { colors.add(value); },
    beginPath() {}, fill() {}, save() {}, restore() {}, clip() {}, closePath() {}, stroke() {},
    fillRect: (x: number, y: number) => point(x, y), rect: (x: number, y: number, w: number, h: number) => { point(x, y); point(x + w, y + h); },
    moveTo: point, lineTo: point, quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => point(x, y),
  };
  return { context: context as unknown as CanvasRenderingContext2D, xs, ys, colors };
}

it("has a metal for every level, Worn as the plain steel, each one its own", () => {
  expect(TOOL_METALS).toHaveLength(TOOL_MAX_LEVEL + 1);
  expect(toolMetal(0)).toBe(PLAIN_STEEL);
  expect(toolMetal(99)).toBe(TOOL_METALS[TOOL_MAX_LEVEL]);
  expect(new Set(TOOL_METALS.map(metal => metal.light)).size).toBe(TOOL_METALS.length);
});

it("paints the Hammer, Knife and Focus inside the wooden sword's canvas, in the level's metal", () => {
  for (const paint of [paintHammer, paintKnife, paintFocus]) {
    const { context, xs, ys, colors } = recorder();
    paint(context, toolMetal(10));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(118);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(59);
    expect(colors.has(toolMetal(10).light)).toBe(true);
  }
});

it("gives no art where there is no canvas", () => {
  expect(toolArtSource("hammer", 3)).toBe("");
});
