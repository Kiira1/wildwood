import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createQuestTrackerSetting, installQuestTracker } from "./quest-tracker";
import type { QuestTrackerView } from "./quest-board-controller";

afterEach(() => vi.unstubAllGlobals());

it("names each quest's stat in the words the enemies' own labels use", () => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="hud"></div></body></html>');
  vi.stubGlobal("window", Object.assign(window, { setInterval: () => 0, clearInterval: () => {}, innerWidth: 800, innerHeight: 600 }));
  vi.stubGlobal("document", document);
  const item = (enemy: string, stat: QuestTrackerView["items"][number]["stat"]) => ({
    key: enemy, enemy, stat, where: "Tutorial Forest - 1", from: "", onMap: true, count: 3, target: 60, share: .05 });
  const view: QuestTrackerView = { done: 0, total: 15, items: [item("Spitter", "damage"), item("Needle", "speed"), item("Brood", "regen")] };
  installQuestTracker({ view: () => view, hiddenHere: () => false, storage: { getItem: () => null, setItem: () => {} }, enabled: () => true });
  const stats = [...document.querySelectorAll(".quest-tracker-stat")].map(stat => stat.textContent);
  // Not "Atk" for damage, which read as attack speed.
  expect(stats).toEqual(["Damage", "Attack Speed", "HP/sec"]);
});

it("hides from its own ×, after saying where to turn it back on, and Settings turns it back on", () => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="hud"></div><button id="questTrackerToggle"></button></body></html>');
  vi.stubGlobal("window", Object.assign(window, { setInterval: () => 0, clearInterval: () => {}, innerWidth: 800, innerHeight: 600 }));
  vi.stubGlobal("document", document);
  const values: Record<string, string> = {};
  const storage = { getItem: (key: string) => values[key] ?? null, setItem: (key: string, value: string) => { values[key] = value; } };
  const setting = createQuestTrackerSetting(storage);
  const view: QuestTrackerView = { done: 0, total: 15, items: [{ key: "a", enemy: "Spitter", stat: "damage", where: "Forest", from: "", onMap: true, count: 1, target: 60, share: 0 }] };
  installQuestTracker({ view: () => view, hiddenHere: () => false, storage, enabled: setting.enabled, set: setting.set });
  const panel = document.querySelector<HTMLElement>(".quest-tracker")!;
  const confirm = document.querySelector<HTMLElement>(".quest-tracker-confirm")!;
  const toggle = document.getElementById("questTrackerToggle")!;
  expect(panel.hidden).toBe(false);
  expect(toggle.textContent).toBe("ON");

  document.querySelector<HTMLButtonElement>(".quest-tracker-hide")!.click();
  expect(confirm.hidden).toBe(false);
  expect(confirm.textContent).toContain("Turn it back on at the Quest Board or in Settings.");
  document.querySelector<HTMLButtonElement>(".quest-tracker-confirm-keep")!.click();
  expect(confirm.hidden).toBe(true);
  expect(panel.hidden).toBe(false);

  document.querySelector<HTMLButtonElement>(".quest-tracker-hide")!.click();
  document.querySelector<HTMLButtonElement>(".quest-tracker-confirm-hide")!.click();
  expect(panel.hidden).toBe(true);
  expect(values["wildstat-quest-tracker-v1"]).toBe("false");
  expect(toggle.textContent).toBe("OFF");

  toggle.click();
  expect(setting.enabled()).toBe(true);
  expect(panel.hidden).toBe(false);
  expect(toggle.textContent).toBe("ON");
});

it("shows no × where nothing can turn it back on", () => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="hud"></div></body></html>');
  vi.stubGlobal("window", Object.assign(window, { setInterval: () => 0, clearInterval: () => {}, innerWidth: 800, innerHeight: 600 }));
  vi.stubGlobal("document", document);
  installQuestTracker({ view: () => null, hiddenHere: () => false, storage: { getItem: () => null, setItem: () => {} }, enabled: () => true });
  expect(document.querySelector<HTMLElement>(".quest-tracker-hide")!.hidden).toBe(true);
});
