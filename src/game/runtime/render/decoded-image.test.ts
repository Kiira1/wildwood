import { afterEach, expect, it, vi } from "vitest";
import { decodedImage, decodeOffThread, releaseDecoded } from "./decoded-image";

afterEach(() => { vi.unstubAllGlobals(); });

const image = (src: string) => ({ src, currentSrc: src }) as HTMLImageElement;
const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };

it("decodes the image's file, not the <img>, and draws the copy until it is let go", async () => {
  const sheet = image("sheet.webp"), copy = bitmap(), blob = {};
  const fetch = vi.fn(async () => ({ ok: true, blob: async () => blob }));
  const create = vi.fn(async () => copy);
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("createImageBitmap", create);
  await decodeOffThread(sheet);
  expect(fetch).toHaveBeenCalledWith("sheet.webp");
  expect(create).toHaveBeenCalledWith(blob);
  expect(decodedImage(sheet)).toBe(copy);
  releaseDecoded(sheet);
  expect(copy.close).toHaveBeenCalled();
  expect(decodedImage(sheet)).toBe(sheet);
});

it("decodes the <img> when its file cannot be read", async () => {
  const sheet = image("missing.webp"), copy = bitmap();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
  const create = vi.fn(async () => copy);
  vi.stubGlobal("createImageBitmap", create);
  await decodeOffThread(sheet);
  expect(create).toHaveBeenCalledWith(sheet);
  expect(decodedImage(sheet)).toBe(copy);
  releaseDecoded(sheet);
});

it("closes a copy that lands after its image was let go", async () => {
  const sheet = image("left.webp"), copy = bitmap();
  let land!: () => void;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => ({}) })));
  vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise(resolve => { land = () => resolve(copy); })));
  const decoding = decodeOffThread(sheet);
  await vi.waitFor(() => expect(land).toBeTypeOf("function"));
  sheet.src = "";
  land();
  await decoding;
  expect(copy.close).toHaveBeenCalled();
  expect(decodedImage(sheet)).toBe(sheet);
});
