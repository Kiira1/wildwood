import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createGameDocument } from "../../tests/helpers/game-document";
import { masteryPointsForLevel } from "../../shared/weapon-mastery";
import { craftExperienceForLevel } from "../../shared/crafting";
import { SOUL_STAT_DETAILS, SOUL_STAT_ORDER, SOUL_TIER_COUNT } from "../../shared/soul-dimension";
import { profileSkillRows, profileSoulTier, renderProfileSkills, renderProfileSoulTier } from "./profile-skills";

const row = (rows: ReturnType<typeof profileSkillRows>, kind: string) => rows.find(entry => entry.kind === kind)!;

describe("the profile's Skills tab", () => {
  it("lists every skill in its group, in order", () => {
    const rows = profileSkillRows({});
    expect(rows.map(entry => entry.kind)).toEqual(["archery", "swordplay", "sorcery", "mining", "woodcutting", "smithing", "fletching", "enchanting"]);
    expect([...new Set(rows.map(entry => entry.group))]).toEqual(["Weapon Mastery", "Gathering", "Crafting"]);
  });

  it("shows another player's levels only, with nothing started read as such", () => {
    const rows = profileSkillRows({ mastery: { archery: 23 }, mining: 340, woodcutting: null, crafts: { fletching: 12 } });
    expect(row(rows, "archery")).toEqual({ kind: "archery", group: "Weapon Mastery", name: "Archery", level: "Lv 23" });
    expect(row(rows, "swordplay").level).toBe("Lv 0");
    expect(row(rows, "mining").level).toBe("340");
    expect(row(rows, "woodcutting").level).toBe("Not Started");
    expect(row(rows, "fletching").level).toBe("Lv 12");
    expect(row(rows, "smithing").level).toBe("Not Started");
    expect(rows.every(entry => !entry.progress && !entry.next)).toBe(true);
  });

  it("shows your own progress to the next level and what it opens next", () => {
    const points = { archery: BigInt(masteryPointsForLevel(6) + 10), swordplay: 0n, sorcery: 0n };
    const rows = profileSkillRows({ mastery: { archery: 6 }, mining: 40, woodcutting: null, crafts: { smithing: 5 } },
      { mastery: points, crafts: { smithing: BigInt(craftExperienceForLevel(5) + 1), fletching: 0n, enchanting: 0n } });
    expect(row(rows, "archery")).toMatchObject({ level: "Lv 6", progress: { into: 10, needed: masteryPointsForLevel(7) - masteryPointsForLevel(6) }, next: "Next: Epic at Lv 7" });
    expect(row(rows, "swordplay")).toMatchObject({ level: "Lv 0", progress: { into: 0, needed: masteryPointsForLevel(1) }, next: "Next: Common at Lv 1" });
    expect(row(rows, "mining")).toMatchObject({ level: "40", progress: { into: 40, needed: 50 }, next: "Next: Iron Ore at 50" });
    expect(row(rows, "woodcutting")).toMatchObject({ level: "Not Started", progress: undefined, next: "Next: Oak Trees at 50" });
    expect(row(rows, "smithing")).toMatchObject({ level: "Lv 5", progress: { into: 1, needed: craftExperienceForLevel(6) - craftExperienceForLevel(5) }, next: "Next: Sturdy at Lv 6" });
    expect(row(rows, "fletching")).toMatchObject({ level: "Not Started", progress: undefined, next: "Next: Common at Lv 3" });
  });

  it("says when a skill has nothing left to open", () => {
    const rows = profileSkillRows({ mining: 1_200 }, { mastery: { sorcery: BigInt(masteryPointsForLevel(50)) } });
    expect(row(rows, "sorcery")).toMatchObject({ level: "Lv 50 Max", progress: undefined, next: undefined });
    expect(row(rows, "mining")).toEqual({ kind: "mining", group: "Gathering", name: "Mining", level: "1,200", next: "Everything Open" });
  });

  it("reads the level the profile has until the live points arrive", () => {
    const rows = profileSkillRows({ mastery: { swordplay: 4 }, crafts: { enchanting: 3 } }, {});
    expect(row(rows, "swordplay")).toMatchObject({ level: "Lv 4", progress: { into: 0 } });
    expect(row(rows, "enchanting").level).toBe("Lv 3");
  });
});

describe("rendering", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = () => {
    const { document } = parseHTML("<!doctype html><html><body><div id=panel></div></body></html>");
    vi.stubGlobal("document", document);
    return document.getElementById("panel") as unknown as HTMLElement;
  };

  it("draws a bar and its numbers on your own skills, and neither on someone else's", () => {
    const panel = stub();
    renderProfileSkills(panel, profileSkillRows({ mining: 40 }, {}));
    expect(panel.querySelectorAll(".profile-skill-heading").length).toBe(3);
    expect(panel.querySelector(".profile-skill-mining .profile-skill-bar > span")?.getAttribute("style")?.replace(/\s/g, "")).toBe("width:80%");
    expect(panel.querySelector(".profile-skill-mining .profile-skill-detail")?.textContent).toBe("40 / 50Next: Iron Ore at 50");
    renderProfileSkills(panel, profileSkillRows({ mining: 40 }));
    expect(panel.querySelectorAll(".profile-skill").length).toBe(8);
    expect(panel.querySelector(".profile-skill-bar, .profile-skill-detail")).toBeNull();
    expect(panel.querySelector(".profile-skill-mining .profile-skill-level")?.textContent).toBe("40");
  });

  it("shows your soul tier kills under Info and hides them on anyone else's profile", () => {
    const container = stub();
    renderProfileSoulTier(container, { damage: 30, health: 25, armor: 30, regen: 10 });
    expect(container.hidden).toBe(false);
    expect(container.querySelector("h3")?.textContent).toBe(`Soul Tier 0 of ${SOUL_TIER_COUNT}`);
    expect([...container.querySelectorAll("dd")].map(dd => dd.textContent)).toEqual(["25 / 25", "25 / 25", "25 / 25", "10 / 25"]);
    expect(container.querySelectorAll(".is-done").length).toBe(3);
    renderProfileSoulTier(container, undefined);
    expect(container.hidden).toBe(true);
    expect(container.children.length).toBe(0);
  });
});

it("names the next soul tier's kills as the Soul Portal does", () => {
  const goal = profileSoulTier({ damage: 200, health: 130, armor: 125, regen: 126 });
  expect(goal.title).toBe(`Soul Tier 2 of ${SOUL_TIER_COUNT}`);
  expect(goal.note).toBe(`Tier 3 wakes ${SOUL_STAT_DETAILS[SOUL_STAT_ORDER[2]].label} enemies. Kill 625 of each:`);
  expect(goal.rows.map(entry => entry.label)).toEqual(["Damage Enemies", "Health Enemies", "Armor Enemies", "Regen Enemies"]);
  expect(profileSoulTier({ damage: 1e12, health: 1e12, armor: 1e12, regen: 1e12 })).toEqual({ title: `Soul Tier ${SOUL_TIER_COUNT}: Every Soul Enemy Awake`, note: "", rows: [] });
});

it("puts Skills beside Stats in the profile and keeps Mastery out of Info", () => {
  const doc = createGameDocument();
  expect([...doc.querySelectorAll("#playerProfile .profile-tab")].map(tab => tab.textContent)).toEqual(["Stats", "Skills", "Info", "Bonuses"]);
  expect(doc.getElementById("profileSkillsPanel")?.getAttribute("aria-labelledby")).toBe("profileSkillsTab");
  expect(doc.getElementById("profileMasteryRow")).toBeNull();
  expect(doc.querySelector("#profileOverviewPanel")?.textContent).not.toMatch(/mastery/i);
  expect(doc.querySelector("#profileOverviewPanel #profileSoulTier")).not.toBeNull();
});
