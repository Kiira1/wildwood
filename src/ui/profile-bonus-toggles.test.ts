import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { createProfileBonusToggles, ownProfileInPlay } from "./profile-bonus-toggles";
import { ALL_BONUSES_ON, type BonusToggles } from "../../shared/bonus-toggles";

function setup(locked: string | null = null) {
  const { document } = parseHTML("<html><body><section id='p'></section></body></html>");
  let toggles: BonusToggles = { ...ALL_BONUSES_ON };
  const sent: BonusToggles[] = [];
  let lock = locked;
  const panel = createProfileBonusToggles(document.getElementById("p") as unknown as HTMLElement, {
    toggles: () => toggles,
    setToggles: async next => { sent.push(next); toggles = next; return { ok: true }; },
    locked: () => lock,
  });
  const switches = () => [...document.querySelectorAll("[role='switch']")] as unknown as HTMLButtonElement[];
  const status = () => document.querySelector(".bonus-toggle-status")!.textContent;
  return { panel, switches, sent, status, setLock: (value: string | null) => { lock = value; } };
}

it("shows a switch for each group, on, and turns one off with a tap", async () => {
  const s = setup();
  expect(s.switches().map(control => control.getAttribute("aria-checked"))).toEqual(["true", "true", "true", "true"]);
  s.switches()[2].click();
  await Promise.resolve(); await Promise.resolve();
  expect(s.sent).toEqual([{ prestige: true, challenge: true, research: false, soul: true }]);
  expect(s.switches()[2].getAttribute("aria-checked")).toBe("false");
});

it("can't be switched during a challenge, and says why", () => {
  const s = setup("Bonuses can't be switched during a challenge.");
  expect(s.switches().every(control => control.disabled)).toBe(true);
  s.switches()[0].click();
  expect(s.sent).toEqual([]);
  expect(s.status()).toContain("challenge");
  s.setLock(null); s.panel.render();
  expect(s.switches().some(control => control.disabled)).toBe(false);
  expect(s.status()).toBe("");
});

it("reads your own profile with the research you switched off left out, anyone else's as it is", () => {
  const coop = { localIdentity: () => "me", researchInPlay: () => ({ warcraft: 0 }) };
  expect(ownProfileInPlay({ identity: "me", research: { warcraft: 9 } }, coop).research).toEqual({ warcraft: 0 });
  expect(ownProfileInPlay({ identity: "them", research: { warcraft: 9 } }, coop).research).toEqual({ warcraft: 9 });
});
