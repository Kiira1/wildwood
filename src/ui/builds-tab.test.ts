import { expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import type { SavedBuild } from "../../shared/builds";

const key = (window: { Event: typeof Event }, name: string) => Object.assign(new window.Event("keydown", { cancelable: true }), { key: name });

it("renames a build from its card: Enter keeps the name, Escape keeps the old one", async () => {
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => { run(); return 0; });
  const { createBuildsTab } = await import("./builds-tab");
  let names = ["", "", ""];
  const rename = vi.fn(async (slot: number, name: string) => { names = names.map((old, at) => at === slot ? name : old); return { ok: true }; });
  const builds: (SavedBuild | null)[] = [{ slot: 0, gear: { HAND: "", HEAD: "", CHEST: "", FEET: "" }, cards: { HAND: [], HEAD: [], CHEST: [] } }, null, null];
  const tab = createBuildsTab({ actions: { builds: () => builds, names: () => names, rename, save: vi.fn(), equip: vi.fn() } as never, itemName: id => id, showMessage: vi.fn() });
  tab.show(true);
  const titles = () => [...tab.element.querySelectorAll(".builds-tab-head strong")].map(title => title.textContent);
  expect(titles()).toEqual(["Build 1", "Build 2", "Build 3"]);
  (tab.element.querySelectorAll<HTMLButtonElement>(".builds-tab-rename")[1]).click();
  const input = tab.element.querySelector<HTMLInputElement>(".builds-tab-name")!;
  input.value = "Boss Rush";
  input.dispatchEvent(key(window as never, "Enter"));
  await Promise.resolve(); await Promise.resolve();
  expect(rename).toHaveBeenCalledWith(1, "Boss Rush");
  expect(titles()).toEqual(["Build 1", "Boss Rush", "Build 3"]);
  (tab.element.querySelectorAll<HTMLButtonElement>(".builds-tab-rename")[1]).click();
  const again = tab.element.querySelector<HTMLInputElement>(".builds-tab-name")!;
  again.value = "Something else";
  again.dispatchEvent(key(window as never, "Escape"));
  expect(rename).toHaveBeenCalledTimes(1);
  expect(titles()).toEqual(["Build 1", "Boss Rush", "Build 3"]);
  vi.unstubAllGlobals();
});
