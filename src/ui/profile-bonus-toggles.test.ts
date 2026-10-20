import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { createProfileBonusToggles } from "./profile-bonus-toggles";
import { BONUS_GROUPS, BONUS_ITEM_IDS } from "../../shared/bonus-toggles";

function setup(locked: string | null = null) {
  const { document } = parseHTML("<html><body><section id='p'></section></body></html>");
  let off: string[] = [];
  const sent: string[][] = [];
  let lock = locked;
  const panel = createProfileBonusToggles(document.getElementById("p") as unknown as HTMLElement, {
    off: () => off,
    setOff: async ids => { sent.push([...ids]); off = [...ids]; return { ok: true }; },
    locked: () => lock,
  });
  const byLabel = (id: string) => document.querySelector(`[role='switch'][aria-labelledby='${id}']`) as unknown as HTMLButtonElement;
  const status = () => document.querySelector(".bonus-toggle-status")!.textContent;
  const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  return { document, panel, byLabel, sent, status, settle, setLock: (value: string | null) => { lock = value; } };
}

it("has one switch for everything, one a group, and one a bonus inside each group's dropdown", () => {
  const s = setup();
  const switches = s.document.querySelectorAll("[role='switch']");
  expect(switches.length).toBe(1 + 4 + BONUS_ITEM_IDS.length);
  const expand = s.document.querySelector(".bonus-toggle-expand") as unknown as HTMLButtonElement;
  const list = s.document.getElementById("bonusToggleList-prestige")!;
  expect(list.hidden).toBe(true);
  expand.click();
  expect(list.hidden).toBe(false);
  expect(expand.getAttribute("aria-expanded")).toBe("true");
  expect(list.querySelectorAll("[role='switch']").length).toBe(BONUS_GROUPS.prestige.items.length);
});

it("switches one bonus off, which shows its group and All Bonuses halfway", async () => {
  const s = setup();
  s.byLabel("bonusToggle-prestige-keenEdge").click();
  await s.settle();
  expect(s.sent).toEqual([["prestige.keenEdge"]]);
  expect(s.byLabel("bonusToggle-prestige-keenEdge").getAttribute("aria-checked")).toBe("false");
  expect(s.byLabel("bonusToggle-prestige").getAttribute("aria-checked")).toBe("mixed");
  expect(s.byLabel("bonusToggle-all").getAttribute("aria-checked")).toBe("mixed");
  expect(s.document.body.textContent).toContain(`1 of ${BONUS_GROUPS.prestige.items.length} off`);
  // A group partly on turns all off; then all on again.
  s.byLabel("bonusToggle-prestige").click();
  await s.settle();
  expect(s.byLabel("bonusToggle-prestige").getAttribute("aria-checked")).toBe("false");
  s.byLabel("bonusToggle-prestige").click();
  await s.settle();
  expect(s.byLabel("bonusToggle-prestige").getAttribute("aria-checked")).toBe("true");
  expect(s.sent.at(-1)).toEqual([]);
});

it("All Bonuses switches everything off and back on", async () => {
  const s = setup();
  s.byLabel("bonusToggle-all").click();
  await s.settle();
  expect(new Set(s.sent.at(-1))).toEqual(new Set(BONUS_ITEM_IDS));
  expect(s.byLabel("bonusToggle-soul-damage").getAttribute("aria-checked")).toBe("false");
  s.byLabel("bonusToggle-all").click();
  await s.settle();
  expect(s.sent.at(-1)).toEqual([]);
});

it("can't be switched during a challenge, and says why", () => {
  const s = setup("Bonuses can't be switched during a challenge.");
  expect([...s.document.querySelectorAll("[role='switch']")].every(control => (control as unknown as HTMLButtonElement).disabled)).toBe(true);
  s.byLabel("bonusToggle-all").click();
  expect(s.sent).toEqual([]);
  expect(s.status()).toContain("challenge");
  s.setLock(null); s.panel.render();
  expect(s.byLabel("bonusToggle-all").disabled).toBe(false);
  expect(s.status()).toBe("");
});
