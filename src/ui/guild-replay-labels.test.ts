import { expect, it, vi } from "vitest";
import { createGuildReplayLabels } from "./guild-replay-labels";

it("rasterizes 40 names and HP labels once across 60 moving frames, and bounds changing-health storage", () => {
  const raster = { setTransform: vi.fn(), strokeText: vi.fn(), fillText: vi.fn() };
  const canvases: { width: number; height: number; getContext: () => typeof raster }[] = [];
  const doc = { createElement: () => {
    const canvas = { width: 0, height: 0, getContext: () => raster }; canvases.push(canvas); return canvas;
  } };
  const main = { drawImage: vi.fn() };
  const labels = createGuildReplayLabels(doc as unknown as Document);
  const draw = (frame: number, hp = "100 / 100", ratio = 2) => {
    for (let i = 0; i < 40; i++) {
      labels.draw(main as unknown as CanvasRenderingContext2D, `name:${i}`, `Player ${i}`, frame + i, 80, 90, 11, 3, ratio);
      labels.draw(main as unknown as CanvasRenderingContext2D, `hp:${i}`, hp, frame + i, 100, 80, 10, 2, ratio);
    }
  };
  for (let frame = 0; frame < 60; frame++) draw(frame);
  expect(raster.fillText).toHaveBeenCalledTimes(80);
  expect(raster.strokeText).toHaveBeenCalledTimes(80);
  expect(main.drawImage).toHaveBeenCalledTimes(4800);
  draw(60, "99 / 100");
  expect(raster.fillText).toHaveBeenCalledTimes(120);
  for (let hp = 98; hp > 0; hp--) draw(61, `${hp} / 100`);
  expect(canvases).toHaveLength(80);
  raster.fillText.mockClear(); draw(62, "1 / 100", 1);
  expect(raster.fillText).toHaveBeenCalledTimes(80);
  labels.dispose(); expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
});
