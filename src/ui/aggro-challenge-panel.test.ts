import { expect, it, vi } from "vitest";
import { CHALLENGE_ANSWER_MS, CHALLENGE_NO_ANSWER } from "./challenge-answer";
import { parseHTML } from "linkedom";
import { createAggroChallengePanel } from "./aggro-challenge-panel";
import type { RewardType } from "../game/enemies";
import { readAggroPicks, writeAggroPicks } from "../game/runtime/aggro-picks";

function setup(state: { active: boolean; completed: number; parked?: boolean }, initial: RewardType[] = []) {
  const { document } = parseHTML("<html><body><div id='c'></div></body></html>");
  // Saved the way the game saves them (aggro-picks.ts): they come back in AGGRO_GROUPS order, not pick order.
  const stored = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); } });
  writeAggroPicks("me", initial, storage);
  const panel = createAggroChallengePanel({ container: document.getElementById("c") as unknown as HTMLElement, state: () => state,
    locked: () => null, goal: () => "Defeat Aegis Prime (map 15)", start: async () => ({ ok: true }), abandon: async () => ({ ok: true }),
    picks: () => readAggroPicks("me", storage), setPicks: next => writeAggroPicks("me", next, storage) });
  const chip = (label: string) => [...document.querySelectorAll(".aggro-pick")].find(element => element.textContent === label) as unknown as HTMLButtonElement;
  const action = () => document.querySelector(".prestige-challenge-action") as unknown as HTMLButtonElement;
  return { panel, chip, action, picks: () => readAggroPicks("me", storage), label: () => document.querySelector(".aggro-picks-label")?.textContent,
    pressed: () => [...document.querySelectorAll(".aggro-pick[aria-pressed='true']")].map(element => element.textContent) };
}

it("asks for the run's picks before it can start; a full set turns a new group away until one is unpicked", () => {
  const s = setup({ active: false, completed: 1 });
  expect(s.action().disabled).toBe(true);
  s.chip("Armor").click(); s.chip("Regen").click();
  expect(s.picks()).toEqual(["armor", "regen"]);
  expect(s.action().disabled).toBe(false);
  s.chip("Damage").click();
  expect(s.picks()).toEqual(["armor", "regen"]);
  expect(s.label()).toContain("Unpick one first");
  s.chip("Armor").click(); s.chip("Damage").click();
  expect(s.picks()).toEqual(["damage", "regen"]);
  expect(s.label()).not.toContain("Unpick one first");
});

it("a run with one group switches with a tap and never drops it", () => {
  const s = setup({ active: true, completed: 0 });
  expect(s.label()).toBe("Pick 1 group to chase you (0/1)");
  s.chip("Damage").click();
  expect(s.picks()).toEqual(["damage"]);
  expect(s.label()).toBe("Chasing you: Damage (tap another to switch)");
  s.chip("Armor").click();
  expect(s.picks()).toEqual(["armor"]);
  // Unpicking the only group waits for another; what chases the player does not change meanwhile.
  s.chip("Armor").click();
  expect(s.picks()).toEqual(["armor"]);
  expect(s.pressed()).toEqual([]);
  s.chip("Regen").click();
  expect(s.picks()).toEqual(["regen"]);
});

it("a run with four groups can switch any of them, not just the first (the 0.901.49 report)", () => {
  const s = setup({ active: true, completed: 3 }, ["damage", "armor", "regen", "crit"]);
  expect(s.label()).toBe("Chasing you: Damage, Armor, Regen, Crit Damage (tap one to unpick it, then pick another)");
  // The old rule replaced the first saved pick, so Armor, Regen and Crit Damage never moved.
  s.chip("Regen").click();
  expect(s.picks()).toEqual(["damage", "armor", "regen", "crit"]);
  expect(s.label()).toBe("Pick 1 more to switch (3/4)");
  expect(s.pressed()).toEqual(["Damage", "Armor", "Crit Damage"]);
  s.chip("Max Health").click();
  expect(s.picks()).toEqual(["damage", "health", "armor", "crit"]);
  s.chip("Crit Damage").click(); s.chip("Atk Speed").click();
  expect(s.picks()).toEqual(["damage", "health", "speed", "armor"]);
  // Full: a new group is turned away rather than replacing one the player meant to keep.
  s.chip("Regen").click();
  expect(s.picks()).toEqual(["damage", "health", "speed", "armor"]);
  expect(s.label()).toContain("Unpick one first");
});

it("gives the button back when the server never answers a drop out", async () => {
  vi.useFakeTimers();
  try {
    const { document } = parseHTML("<html><body><div id='c'></div></body></html>");
    createAggroChallengePanel({ container: document.getElementById("c") as unknown as HTMLElement, state: () => ({ active: true, completed: 0 }),
      locked: () => null, goal: () => "Defeat Aegis Prime (map 15)", start: async () => ({ ok: true }), abandon: () => new Promise(() => {}),
      picks: () => ["damage"], setPicks: () => {}, confirm: async () => true });
    const action = document.querySelector(".prestige-challenge-action") as unknown as HTMLButtonElement;
    action.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(action.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(CHALLENGE_ANSWER_MS);
    expect(action.disabled).toBe(false);
    expect(document.body.textContent).toContain(CHALLENGE_NO_ANSWER);
  } finally { vi.useRealTimers(); }
});
