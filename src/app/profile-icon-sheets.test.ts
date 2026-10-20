import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { PROFILE_ICON_SHEETS } from "../../shared/profile-icons";

type FakeImage = { src: string; fetchPriority?: string; onload: (() => void) | null; onerror: (() => void) | null };
let images: FakeImage[] = [];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  images = [];
  const { document, window } = parseHTML('<html><body></body></html>');
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
  vi.stubGlobal("Image", class { src = ""; onload = null; onerror = null; constructor() { images.push(this as unknown as FakeImage); } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function load() {
  const [{ applyProfileIcon }, entry] = await Promise.all([import("./profile-icons"), import("./after-entry")]);
  const portrait = (icon: number) => { const element = document.createElement("span"); document.body.append(element); applyProfileIcon(element, icon); return element; };
  return { applyProfileIcon, portrait, markEntered: entry.markEntered };
}
const people = PROFILE_ICON_SHEETS[0].path, varied = PROFILE_ICON_SHEETS[1].path;

it("loads no sheet on the loading screen, then only the one a portrait shows, at low priority", async () => {
  const f = await load();
  const hud = f.portrait(3);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(images).toHaveLength(0);
  expect(hud.style.backgroundImage).toBe("none");
  expect(hud.style.backgroundColor).toBeTruthy();
  f.markEntered();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(images.map(image => image.src)).toEqual([people]);
  expect(images[0].fetchPriority).toBe("low");
  expect(hud.style.backgroundImage).toBe("none");
  images[0].onload!();
  expect(hud.style.backgroundImage).toContain(people);
});

it("shares one load per sheet and paints every portrait waiting on it", async () => {
  const f = await load();
  f.markEntered();
  const first = f.portrait(1), second = f.portrait(2);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(images).toHaveLength(1);
  images[0].onload!();
  expect([first, second].every(element => element.style.backgroundImage.includes(people))).toBe(true);
  const third = f.portrait(4);
  expect(third.style.backgroundImage).toContain(people);
  expect(images).toHaveLength(1);
});

it("paints the picture a portrait shows now, not one it showed before the sheet loaded", async () => {
  const f = await load();
  f.markEntered();
  const element = f.portrait(1);
  f.applyProfileIcon(element, 70);
  await vi.advanceTimersByTimeAsync(1_000);
  const [peopleSheet, variedSheet] = [images.find(image => image.src === people)!, images.find(image => image.src === varied)!];
  peopleSheet.onload!();
  expect(element.style.backgroundImage).toBe("none");
  variedSheet.onload!();
  expect(element.style.backgroundImage).toContain(varied);
});

it("asks for nothing while a portrait is off screen, and its sheet once it shows", async () => {
  let report!: (entries: { target: Element; isIntersecting: boolean }[]) => void;
  const observed = new Set<Element>();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof report) { report = callback; }
    observe(target: Element) { observed.add(target); }
    unobserve(target: Element) { observed.delete(target); }
  });
  const f = await load();
  f.markEntered();
  const hidden = f.portrait(1);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(images).toHaveLength(0);
  expect(observed.has(hidden)).toBe(true);
  report([{ target: hidden, isIntersecting: true }]);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(images.map(image => image.src)).toEqual([people]);
  expect(observed.has(hidden)).toBe(false);
});

it("tries a failed sheet again while a portrait still wants it", async () => {
  const f = await load();
  f.markEntered();
  const element = f.portrait(1);
  await vi.advanceTimersByTimeAsync(1_000);
  images[0].onerror!();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(images).toHaveLength(2);
  images[1].onload!();
  expect(element.style.backgroundImage).toContain(people);
});
