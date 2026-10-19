import { expect, it } from "vitest";
import { WEAPON_ALIGNMENT_DEFAULTS } from "../../equipment-alignment";
import { HATCHET_OVERRIDES, WOODCUTTING_HATCHET, paintHatchet } from "./hatchet-sprite";
import { PICKAXE_PRESENTATION } from "./pickaxe-sprite";

it("is painted inside the Wooden Sword's canvas, gripped where it is, and swings as the pickaxe does", () => {
  const xs: number[] = [], ys: number[] = [];
  const point = (x: number, y: number) => { xs.push(x); ys.push(y); };
  const context = {
    lineWidth: 1, lineJoin: "", lineCap: "", strokeStyle: "", fillStyle: "",
    beginPath() {}, fill() {}, save() {}, restore() {}, clip() {}, closePath() {}, stroke() {}, fillRect() {},
    moveTo: point, lineTo: point, quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => point(x, y),
  };
  paintHatchet(context as unknown as CanvasRenderingContext2D);
  expect(Math.max(...xs) + 3).toBeLessThanOrEqual(104);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
  expect(Math.min(...xs)).toBeLessThan(118 * WEAPON_ALIGNMENT_DEFAULTS.SWORD.pivotX!);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(3);
  expect(Math.max(...ys)).toBeLessThanOrEqual(56);
  expect(HATCHET_OVERRIDES[WOODCUTTING_HATCHET]).toBe(PICKAXE_PRESENTATION);
});
