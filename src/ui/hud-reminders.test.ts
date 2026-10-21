import { expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { hudReminderMarkup, installHudReminders } from "./hud-reminders";

function setup(stored: Record<string, string> = {}) {
  const { document } = parseHTML(`<html><body>
    <button id="townBtn"></button>
    <div class="hud-timer-column"><button id="enemyRespawnAdBtn"></button></div>
    ${hudReminderMarkup()}
    <div id="settingsPanel"><div class="setting-row"><span>Stat Tracker</span><button id="statTrackerToggle"></button></div></div>
  </body></html>`);
  const townButton = document.getElementById("townBtn") as unknown as HTMLButtonElement;
  const teleports = vi.fn();
  townButton.addEventListener("click", teleports);
  const storage = { values: { ...stored } as Record<string, string>, getItem(key: string) { return this.values[key] ?? null; }, setItem(key: string, value: string) { this.values[key] = value; } };
  let inTown = false;
  const reminders = installHudReminders({
    column: document.querySelector(".hud-timer-column") as unknown as HTMLElement,
    before: document.getElementById("enemyRespawnAdBtn") as unknown as HTMLElement,
    townButton, settingsPanel: document.getElementById("settingsPanel") as unknown as HTMLElement,
    inTown: () => inTown, storage,
  });
  const chip = (id: string) => document.getElementById(id) as unknown as HTMLElement;
  return { document, chip, teleports, storage, reminders, setInTown: (value: boolean) => { inTown = value; } };
}

it("puts Research Ready and Gear Upgrades in the timer column, above the ad button, hidden until true", () => {
  const h = setup();
  const column = h.document.querySelector(".hud-timer-column")!;
  expect([...column.children].map(child => child.id)).toEqual(["researchReadyHint", "smithBuyNotice", "enemyRespawnAdBtn"]);
  expect(h.chip("researchReadyHint").hidden).toBe(true);
  // Nothing on the Town button.
  expect(h.document.getElementById("townBtn")!.children).toHaveLength(0);
});

it("teleports to the Town through the Town button away from it, and is only a reminder in it", () => {
  const h = setup();
  h.chip("researchReadyHint").hidden = false;
  h.chip("researchReadyHint").click();
  expect(h.teleports).toHaveBeenCalledTimes(1);
  h.setInTown(true);
  h.reminders.refresh();
  h.chip("smithBuyNotice").click();
  expect(h.teleports).toHaveBeenCalledTimes(1);
  expect(h.chip("smithBuyNotice").classList.contains("is-in-town")).toBe(true);
});

it("has a Settings switch for each, on by default, remembered, placed with the HUD rows", () => {
  const h = setup({ "wildstat-hud-smith-upgrades-visible": "false" });
  const rows = [...h.document.querySelectorAll("#settingsPanel .setting-row")].map(row => row.querySelector("span")!.textContent);
  expect(rows).toHaveLength(3);
  expect(rows.at(-1)).toBe("Stat Tracker");
  const research = h.document.querySelector<HTMLButtonElement>('[aria-label="Research Ready Hint"]')!;
  expect(research.getAttribute("aria-pressed")).toBe("true");
  expect(h.chip("smithBuyNotice").classList.contains("is-switched-off")).toBe(true);
  research.click();
  expect(h.chip("researchReadyHint").classList.contains("is-switched-off")).toBe(true);
  expect(h.storage.values["wildstat-hud-research-ready-visible"]).toBe("false");
});
