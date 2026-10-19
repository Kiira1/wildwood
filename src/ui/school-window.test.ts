import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { masteryPointsForLevel, type WeaponSchool } from "../../shared/weapon-mastery";
import { createSchoolWindowController, schoolPassiveNow } from "./school-window";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function schoolWindow(points: Partial<Record<WeaponSchool, bigint>>, inTown = () => true) {
  const { document } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  const clearInput = vi.fn();
  const controller = createSchoolWindowController({ inTown, clearInput, points: () => points });
  const dialog = document.querySelector("dialog") as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  const text = (selector: string) => dialog.querySelector(selector)!.textContent;
  const bar = () => ["now", "min", "max"].map(name => dialog.querySelector(".school-window-bar")!.getAttribute(`aria-value${name}`));
  const techniques = () => [...dialog.querySelectorAll<HTMLElement>(".school-window-technique")].map(row => ({
    id: row.dataset.technique,
    level: row.querySelector(".school-window-technique-level")!.textContent,
    status: row.querySelector(".school-window-technique-status")!.textContent,
    locked: row.classList.contains("is-locked"),
  }));
  return { controller, dialog, text, bar, techniques, clearInput };
}

it("names the building and shows the school's level, progress and what trains it", () => {
  vi.useFakeTimers();
  const view = schoolWindow({ archery: 1_500n });
  view.controller.open("archery");
  expect(view.controller.isOpen()).toBe(true);
  expect(view.text(".window-banner")).toBe("Archery Range");
  expect(view.text(".school-window-head strong")).toBe("Archery");
  expect(view.text(".school-window-level")).toBe("Lv 1");
  expect(view.text(".school-window-points")).toBe("500 / 1,110");
  expect(view.bar()).toEqual(["500", "0", "1110"]);
  expect(view.dialog.querySelector(".school-window-bar")!.getAttribute("role")).toBe("progressbar");
  expect(view.text(".school-window-train")).toBe("Every kill with a bow trains Archery. Prestige keeps Mastery.");
  view.controller.close();
  expect(view.controller.isOpen()).toBe(false);
  expect(view.clearInput).toHaveBeenCalled();
});

it("shows the passive a level and its total now, and Skill Proficiency from the level", () => {
  const view = schoolWindow({ archery: BigInt(masteryPointsForLevel(10)), swordplay: BigInt(masteryPointsForLevel(10)), sorcery: BigInt(masteryPointsForLevel(12)) });
  view.controller.open("archery");
  expect(view.text(".school-window-passive dt")).toBe("Range");
  expect(view.text(".school-window-per-level")).toBe("+0.4 attack range a level");
  expect(view.text(".school-window-now")).toBe("+4.0 now");
  expect(view.text(".school-window-proficiency dt")).toBe("Skill Proficiency");
  expect(view.text(".school-window-proficiency dd")).toBe("Weapon skills fire 10% more often");
  // Another school's building renders that school in the same window.
  view.controller.open("swordplay");
  expect(view.text(".window-banner")).toBe("Sword Hall");
  expect(view.text(".school-window-train")).toBe("Every kill with a sword trains Swordplay. Prestige keeps Mastery.");
  expect(view.text(".school-window-now")).toBe("2.0% less now");
  view.controller.close();
  view.controller.open("sorcery");
  expect(view.text(".window-banner")).toBe("Mage Tower");
  expect(view.text(".school-window-passive dt")).toBe("Blast");
  expect(view.text(".school-window-now")).toBe("+6.0% now");
  expect(view.text(".school-window-proficiency dd")).toBe("Weapon skills fire 12% more often");
  expect(schoolPassiveNow("archery", 0)).toBe("+0.0 now");
});

it("lists the five techniques, learned up to the level and locked past it", () => {
  const view = schoolWindow({ swordplay: BigInt(masteryPointsForLevel(20)) });
  view.controller.open("swordplay");
  expect(view.techniques()).toEqual([
    { id: "cleave", level: "Lv 10", status: "Learned", locked: false },
    { id: "parry", level: "Lv 20", status: "Learned", locked: false },
    { id: "bloodlust", level: "Lv 30", status: "Unlocks at Lv 30", locked: true },
    { id: "momentum", level: "Lv 40", status: "Unlocks at Lv 40", locked: true },
    { id: "bladeStorm", level: "Lv 50", status: "Unlocks at Lv 50", locked: true },
  ]);
});

it("tops out at Max, every technique learned, and starts from nothing with none", () => {
  const view = schoolWindow({ sorcery: BigInt(masteryPointsForLevel(50) + 5) });
  view.controller.open("sorcery");
  expect(view.text(".school-window-level")).toBe("Lv 50 · Max");
  expect(view.text(".school-window-points")).toBe("Max Level");
  expect(view.bar()).toEqual(["1", "0", "1"]);
  expect(view.techniques().every(row => row.status === "Learned")).toBe(true);
  view.controller.close();
  view.controller.open("archery");
  expect(view.text(".school-window-level")).toBe("Lv 0");
  expect(view.text(".school-window-points")).toBe("0 / 1,000");
  expect(view.techniques().every(row => row.locked)).toBe(true);
});

it("opens only in the Town and follows Mastery that arrives while open", () => {
  vi.useFakeTimers();
  let inTown = false;
  const points: Partial<Record<WeaponSchool, bigint>> = {};
  const view = schoolWindow(points, () => inTown);
  view.controller.open("archery");
  expect(view.controller.isOpen()).toBe(false);
  inTown = true;
  view.controller.open("archery");
  expect(view.text(".school-window-level")).toBe("Lv 0");
  points.archery = BigInt(masteryPointsForLevel(3));
  vi.advanceTimersByTime(1_000);
  expect(view.text(".school-window-level")).toBe("Lv 3");
  view.dialog.dispatchEvent(new (view.dialog.ownerDocument.defaultView as unknown as typeof globalThis).Event("cancel", { cancelable: true }));
  expect(view.controller.isOpen()).toBe(false);
});
