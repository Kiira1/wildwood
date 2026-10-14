import { expect, it } from "vitest";
import { WEAPON_ALIGNMENT_DEFAULTS } from "../../equipment-alignment";
import { paintPickaxe } from "./pickaxe-sprite";

/** Every point the paint goes through, and the head's (its one closed path) apart. */
function painted() {
  const points: [number, number][] = [];
  let path: [number, number][] = [], head: [number, number][] = [], clipped = false;
  const context = {
    lineWidth: 1, lineJoin: "", lineCap: "", strokeStyle: "", fillStyle: "",
    beginPath() { path = []; }, fill() {}, save() {}, restore() { clipped = false; }, clip() { clipped = true; },
    closePath() { head = path; },
    moveTo: (x: number, y: number) => { path.push([x, y]); points.push([x, y]); },
    lineTo: (x: number, y: number) => { path.push([x, y]); points.push([x, y]); },
    quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => { path.push([x, y]); points.push([x, y]); },
    stroke() {},
    // A fill inside the head's clip only shades it.
    fillRect: (x: number, y: number, w: number, h: number) => { if (!clipped) points.push([x, y], [x + w, y + h]); },
  };
  paintPickaxe(context as unknown as CanvasRenderingContext2D);
  return { points, head };
}

it("is about as long as the Wooden Sword, gripped where it is, with a deep head", () => {
  const { points, head } = painted();
  const xs = points.map(([x]) => x);
  // The sword's art runs from about x 14 to 97 of the same 118 × 59 canvas, and is held at the same grip.
  // Its head's outline is 3 wide.
  expect(Math.max(...xs) + 3).toBeLessThanOrEqual(100);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
  expect(Math.min(...xs)).toBeLessThan(118 * WEAPON_ALIGNMENT_DEFAULTS.SWORD.pivotX!);
  // The head spans most of the canvas's height, and is thick at the eye, not a thin crescent.
  const headYs = head.map(([, y]) => y), eye = head.filter(([, y]) => y > 20 && y < 40).map(([x]) => x);
  expect(Math.max(...headYs) - Math.min(...headYs)).toBeGreaterThan(48);
  expect(Math.max(...eye) - Math.min(...eye)).toBeGreaterThanOrEqual(18);
});
