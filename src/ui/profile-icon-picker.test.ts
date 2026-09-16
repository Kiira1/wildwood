import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createProfileIconPicker } from "./profile-icon-picker";
import { applyProfileIcon, createProfileIconCanvasPainter } from "../app/profile-icons";
import { isValidProfileIcon, profileIconLocation } from "../../shared/profile-icons";

beforeEach(() => {
  const { document, window } = parseHTML('<html><body><div><div id="choices"></div></div></body></html>');
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
});
afterEach(() => vi.unstubAllGlobals());

function fixture(selected = 0, setIcon = vi.fn(async () => ({ ok: true }))) {
  const choices = document.getElementById("choices")!;
  const onSaved = vi.fn(), onError = vi.fn();
  const picker = createProfileIconPicker(choices, { selectedIcon: () => selected, paintIcon: applyProfileIcon, setIcon, onSaved, onError });
  picker.open();
  return { choices, picker, setIcon, onSaved, onError };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

it("preserves old portraits and maps every new sheet boundary consistently", () => {
  for (const [index, sheet, cell] of [[0,0,0], [63,0,63], [64,1,0], [127,1,63], [128,2,0], [191,2,63]]) {
    const location = profileIconLocation(index);
    expect(location.sheetIndex).toBe(sheet); expect(location.cell).toBe(cell);
    const element = document.createElement("span"); applyProfileIcon(element, index);
    expect(element.style.backgroundImage).toContain(location.path);
    expect(element.dataset.profileIcon).toBe(String(index));
    expect(isValidProfileIcon(index)).toBe(true);
  }
  for (const invalid of [-1, 192, NaN, Infinity, 1.5]) expect(isValidProfileIcon(invalid)).toBe(false);
});

it("offers all people and objects separately and opens the selected category", () => {
  const f = fixture(191);
  expect(f.choices.children).toHaveLength(64);
  expect(f.choices.querySelector('[aria-pressed="true"]')?.getAttribute("data-profile-icon")).toBe("191");
  document.getElementById("profile-icon-tab-people")!.click();
  expect(f.choices.children).toHaveLength(128);
  expect(f.choices.firstElementChild?.getAttribute("data-profile-icon")).toBe("64");
  expect(f.choices.querySelector('[data-profile-icon="63"]')).not.toBeNull();
});

it("keeps the picker available after a failed save and prevents duplicate requests", async () => {
  let finish!: (result: { ok: boolean }) => void;
  const setIcon = vi.fn(() => new Promise<{ ok: boolean }>(resolve => { finish = resolve; }));
  const f = fixture(0, setIcon);
  const button = f.choices.firstElementChild as HTMLButtonElement;
  button.click(); button.click();
  expect(setIcon).toHaveBeenCalledTimes(1); expect(button.disabled).toBe(true);
  finish({ ok: false }); await flush();
  expect(f.onError).toHaveBeenCalledOnce(); expect(button.disabled).toBe(false);
  button.click(); finish({ ok: true }); await flush();
  expect(f.onSaved).toHaveBeenCalledOnce();
});

it("ignores a save completion after the picker was closed and reopened", async () => {
  let finish!: (result: { ok: boolean }) => void;
  const f = fixture(0, vi.fn(() => new Promise<{ ok: boolean }>(resolve => { finish = resolve; })));
  (f.choices.firstElementChild as HTMLButtonElement).click();
  f.picker.close(); f.picker.open(); finish({ ok: true }); await flush();
  expect(f.onSaved).not.toHaveBeenCalled();
  expect(f.choices.hasAttribute("aria-busy")).toBe(false);
});

it("loads canvas sheets once on demand and paints the correct cell after loading", () => {
  const images: any[] = [];
  class FakeImage {
    complete = false; naturalWidth = 1254; naturalHeight = 1254; src = "";
    loaded?: () => void;
    constructor() { images.push(this); }
    addEventListener(_event: string, listener: () => void) { this.loaded = listener; }
  }
  vi.stubGlobal("Image", FakeImage);
  const context = { clearRect: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: false };
  const canvas = { width: 40, height: 40, getContext: () => context } as unknown as HTMLCanvasElement;
  const loaded = vi.fn(), paint = createProfileIconCanvasPainter(loaded);
  paint(canvas, 128); paint(canvas, 191);
  expect(images).toHaveLength(1); expect(images[0].src).toContain("profile-objects-grid");
  expect(context.drawImage).not.toHaveBeenCalled();
  images[0].complete = true; images[0].loaded(); paint(canvas, 191);
  expect(loaded).toHaveBeenCalledOnce();
  expect(context.drawImage.mock.calls[0][1]).toBeGreaterThan(7 * 1254 / 8);
  paint(canvas, 64); paint(canvas, 0);
  expect(images).toHaveLength(3);
});
