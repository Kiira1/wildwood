import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { createAggroPickPrompt } from "./aggro-pick-prompt";
import { pickRefused, togglePick } from "../game/runtime/auto-farm/aggro-picks";
import type { RewardType } from "../game/enemies";
import type { AutoFarmPriority } from "../game/runtime/auto-farm/auto-farm-priority";

it("stays open until the run has its count of groups", () => {
  const { document } = parseHTML("<html><body></body></html>");
  let picks: RewardType[] = [];
  const prompt = createAggroPickPrompt(document as unknown as Document, { picks: () => picks, setPicks: next => { picks = next; } });
  prompt.open(2);
  const done = document.querySelector(".aggro-pick-done") as unknown as HTMLButtonElement;
  const chip = (label: string) => [...document.querySelectorAll(".aggro-pick")].find(element => element.textContent === label) as unknown as HTMLButtonElement;
  expect(done.disabled).toBe(true);
  done.click();
  expect(prompt.isOpen()).toBe(true);
  chip("Damage").click(); chip("Regen").click();
  expect(done.disabled).toBe(false);
  done.click();
  expect(prompt.isOpen()).toBe(false);
  expect(picks).toEqual(["damage", "regen"]);
});

it("unpicks a picked group, adds while there is room, and with a full set only a count of one switches", () => {
  expect(togglePick(["damage"], "armor", 1)).toEqual(["armor"]);
  expect(togglePick(["damage"], "damage", 1)).toEqual([]);
  expect(togglePick(["damage"], "regen", 2)).toEqual(["damage", "regen"]);
  expect(togglePick(["damage", "armor"], "regen", 2)).toEqual(["damage", "armor"]);
  expect(togglePick(["damage", "armor"], "armor", 2)).toEqual(["damage"]);
  expect(pickRefused(["damage", "armor"], "regen", 2)).toBe(true);
  expect(pickRefused(["damage"], "regen", 1)).toBe(false);
});

it("swaps any pick in a full set: unpick one, pick another, Done", () => {
  const { document } = parseHTML("<html><body></body></html>");
  let picks: RewardType[] = ["damage", "armor", "regen", "crit"];
  const prompt = createAggroPickPrompt(document as unknown as Document, { picks: () => picks, setPicks: next => { picks = next; } });
  prompt.open(4);
  const chip = (label: string) => [...document.querySelectorAll(".aggro-pick")].find(element => element.textContent === label) as unknown as HTMLButtonElement;
  const done = document.querySelector(".aggro-pick-done") as unknown as HTMLButtonElement;
  const label = () => document.querySelector(".aggro-picks-label")!.textContent;
  chip("Max Health").click();
  expect(label()).toBe("Pick 4 groups to chase you (4/4) · Unpick one first");
  expect(chip("Max Health").getAttribute("aria-pressed")).toBe("false");
  chip("Crit Damage").click();
  expect(done.disabled).toBe(true);
  chip("Max Health").click();
  expect(label()).toBe("Pick 4 groups to chase you (4/4)");
  done.click();
  expect(picks).toEqual(["damage", "armor", "regen", "health"]);
});

it("offers only this map's groups, and asks again when a pick is missing here", () => {
  const { document } = parseHTML("<html><body></body></html>");
  let picks: RewardType[] = ["speed"];
  const prompt = createAggroPickPrompt(document as unknown as Document, { picks: () => picks, setPicks: next => { picks = next; } });
  // A map with no Atk Speed enemies: the saved pick cannot chase here.
  const here: RewardType[] = ["damage", "health", "armor"];
  expect(prompt.lacking(1, here)).toBe(true);
  expect(prompt.lacking(1, ["speed", "damage"])).toBe(false);
  prompt.open(1, here);
  const chips = [...document.querySelectorAll(".aggro-pick")] as unknown as HTMLButtonElement[];
  expect(chips.filter(chip => !chip.hidden).map(chip => chip.textContent)).toEqual(["Damage", "Max Health", "Armor"]);
  const done = document.querySelector(".aggro-pick-done") as unknown as HTMLButtonElement;
  expect(done.disabled).toBe(true);
  chips.find(chip => chip.textContent === "Armor")!.click();
  done.click();
  expect(picks).toEqual(["armor"]);
  expect(prompt.isOpen()).toBe(false);
  expect(prompt.lacking(1, here)).toBe(false);
});

it("changes nothing that chases the player until Done: unpicking everything and leaving it open is not a way out", () => {
  const { document } = parseHTML("<html><body></body></html>");
  let picks: RewardType[] = ["damage"];
  const prompt = createAggroPickPrompt(document as unknown as Document, { picks: () => picks, setPicks: next => { picks = next; } });
  prompt.open(1);
  const chip = (label: string) => [...document.querySelectorAll(".aggro-pick")].find(element => element.textContent === label) as unknown as HTMLButtonElement;
  chip("Damage").click();
  expect(picks).toEqual(["damage"]);
  expect((document.querySelector(".aggro-pick-done") as unknown as HTMLButtonElement).disabled).toBe(true);
  chip("Regen").click();
  (document.querySelector(".aggro-pick-done") as unknown as HTMLButtonElement).click();
  expect(picks).toEqual(["regen"]);
});

it("holds autofarm's Target, which applies on tap without waiting for Done", () => {
  const { document } = parseHTML("<html><body></body></html>");
  let picks: RewardType[] = [], priority: AutoFarmPriority = "closest";
  const prompt = createAggroPickPrompt(document as unknown as Document, { picks: () => picks, setPicks: next => { picks = next; },
    priority: () => priority, setPriority: next => { priority = next; } });
  prompt.open(1);
  const targets = [...document.querySelectorAll(".aggro-pick-target [data-priority]")] as unknown as HTMLButtonElement[];
  expect(targets.map(button => button.textContent)).toEqual(["Closest", "Lowest HP", "Strongest"]);
  expect(targets.map(button => button.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  targets[2].click();
  expect(priority).toBe("strongest");
  expect(targets.map(button => button.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
  // Picks still gate Done; Target never does.
  expect(prompt.isOpen()).toBe(true);
  expect((document.querySelector(".aggro-pick-done") as unknown as HTMLButtonElement).disabled).toBe(true);
});

it("has no Target row without a farm to set it on", () => {
  const { document } = parseHTML("<html><body></body></html>");
  createAggroPickPrompt(document as unknown as Document, { picks: () => [], setPicks: () => {} }).open(1);
  expect(document.querySelector(".aggro-pick-target")).toBeNull();
});

it("holds autofarm's Move On switch, since during a run it is the only window", () => {
  const { document } = parseHTML("<html><body></body></html>");
  let picks: RewardType[] = [], advance = true;
  const prompt = createAggroPickPrompt(document as unknown as Document, { picks: () => picks, setPicks: next => { picks = next; },
    advance: () => advance, setAdvance: on => { advance = on; } });
  prompt.open(1);
  const button = (name: string, on: 0 | 1) => document.querySelector<HTMLButtonElement>(`[data-switch="${name}"][data-on="${on}"]`)!;
  expect(document.querySelector('[data-switch="bosses"]')).toBeNull();
  expect(button("advance", 1).getAttribute("aria-checked")).toBe("true");
  button("advance", 0).click();
  expect(advance).toBe(false);
  expect(button("advance", 1).getAttribute("aria-checked")).toBe("false");
});
