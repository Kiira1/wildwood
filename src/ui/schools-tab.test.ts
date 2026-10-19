import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { IRON_BOW, WOODEN_SWORD } from "../../shared/items";
import { masteryPointsForLevel } from "../../shared/weapon-mastery";
afterEach(() => vi.unstubAllGlobals());

async function schoolsTab(points: Record<string, bigint>, activeWeapon: () => string | undefined) {
  const { document } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  const { createSchoolsTab } = await import("./schools-tab");
  const tab = createSchoolsTab({ points: () => points, activeWeapon });
  tab.show(true);
  const cards = () => [...tab.element.querySelectorAll<HTMLElement>(".schools-tab-card")].map(card => ({
    school: card.dataset.school,
    name: card.querySelector("strong")!.textContent,
    level: card.querySelector(".schools-tab-level")!.textContent,
    points: card.querySelector(".schools-tab-points")!.textContent,
    inHand: card.querySelector(".schools-tab-in-hand") !== null,
    bar: ["now", "min", "max"].map(name => card.querySelector(".schools-tab-bar")!.getAttribute(`aria-value${name}`)),
  }));
  return { tab, cards };
}

it("shows each school's Mastery level and progress, with In Hand on the school of the held weapon", async () => {
  const { tab, cards } = await schoolsTab({ archery: 1_500n, sorcery: BigInt(masteryPointsForLevel(50) + 5) }, () => IRON_BOW);
  expect(tab.element.hidden).toBe(false);
  expect(cards()).toEqual([
    { school: "archery", name: "Archery", level: "Lv 1", points: "500 / 1,110", inHand: true, bar: ["500", "0", "1110"] },
    { school: "swordplay", name: "Swordplay", level: "Lv 0", points: "0 / 1,000", inHand: false, bar: ["0", "0", "1000"] },
    { school: "sorcery", name: "Sorcery", level: "Lv 50 · Max", points: "Max Level", inHand: false, bar: ["1", "0", "1"] },
  ]);
  expect(tab.element.querySelectorAll(".schools-tab-bar[role=progressbar]")).toHaveLength(3);
  expect(tab.element.textContent).toContain("Every kill trains the school of the weapon in your hand.");
  tab.show(false);
  expect(tab.element.hidden).toBe(true);
});

it("moves In Hand when the weapon changes and redraws only when something changed", async () => {
  let weapon: string = IRON_BOW;
  const { tab, cards } = await schoolsTab({}, () => weapon);
  const first = tab.element.querySelector(".schools-tab-card");
  tab.render();
  expect(tab.element.querySelector(".schools-tab-card")).toBe(first);
  weapon = WOODEN_SWORD;
  tab.render();
  expect(cards().map(card => card.inHand)).toEqual([false, true, false]);
});
