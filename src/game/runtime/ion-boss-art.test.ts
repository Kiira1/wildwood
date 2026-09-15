import { expect, it, vi } from "vitest";
import { drawAegisPrimeArt } from "./ion-boss-art";

it("renders hurt without allocating filter effects and restores state even if drawing fails", () => {
  const ctx = new Proxy({ globalAlpha: 1, filter: "none" } as any, { get: (target, key) => target[key] ??= vi.fn() });
  const sprite = { naturalWidth: 512, naturalHeight: 512 } as HTMLImageElement;
  drawAegisPrimeArt(ctx, 100, 100, 1, "laser", .2, sprite);
  expect(ctx.filter).toBe("none");
  expect(ctx.drawImage).toHaveBeenCalledOnce();
  ctx.drawImage.mockImplementationOnce(() => { throw new Error("GPU draw failed"); });
  expect(() => drawAegisPrimeArt(ctx, 100, 100, 1, "emp", .2, sprite)).toThrow("GPU draw failed");
  expect(ctx.restore).toHaveBeenCalledTimes(2);
});
