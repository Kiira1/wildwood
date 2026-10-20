import { expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { hudReminderMarkup, installHudReminders } from "./hud-reminders";

function setup(stored: Record<string, string> = {}) {
  const { document } = parseHTML(`<html><body>
    <button id="techTreeBtn"></button>
    <div class="hud-timer-column"><button id="enemyRespawnAdBtn"></button></div>
    ${hudReminderMarkup()}
    <div id="settingsPanel"><div class="setting-row"><span>Stat Tracker</span><button id="statTrackerToggle"></button></div></div>
  </body></html>`);
  const townButton = document.getElementById("techTreeBtn") as unknown as HTMLButtonElement;
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

it("puts Research Ready and Upgrades At The Smith in the timer column, above the ad button, hidden until true", () => {
  const h = setup();
  const column = h.document.querySelector(".hud-timer-column")!;
  expect([...column.children].map(child => child.id)).toEqual(["techTreeNotice", "smithUpgradeNotice", "enemyRespawnAdBtn"]);
  expect(h.chip("techTreeNotice").textContent).toBe("Research Ready");
  expect(h.chip("smithUpgradeNotice").textContent).toBe("Upgrades At The Smith");
  expect(h.chip("techTreeNotice").hidden).toBe(true);
  // Nothing on the Town button any more.
  expect(h.document.getElementById("techTreeBtn")!.children).toHaveLength(0);
});

it("teleports to the Town through the Town button away from it, and is only a reminder in it", () => {
  const h = setup();
  h.chip("techTreeNotice").hidden = false;
  h.chip("techTreeNotice").click();
  expect(h.teleports).toHaveBeenCalledTimes(1);
  h.setInTown(true);
  h.reminders.refresh();
  h.chip("smithUpgradeNotice").click();
  expect(h.teleports).toHaveBeenCalledTimes(1);
  expect(h.chip("smithUpgradeNotice").classList.contains("is-in-town")).toBe(true);
});

it("has a Settings switch for each, on by default, remembered, placed with the HUD rows", () => {
  const h = setup({ "wildstat-hud-smith-upgrades-visible": "false" });
  const rows = [...h.document.querySelectorAll("#settingsPanel .setting-row")].map(row => row.querySelector("span")!.textContent);
  expect(rows).toEqual(["Research Ready Hint", "Smith Upgrades Hint", "Stat Tracker"]);
  const research = h.document.querySelector<HTMLButtonElement>('[aria-label="Research Ready Hint"]')!;
  expect(research.getAttribute("aria-pressed")).toBe("true");
  expect(h.chip("smithUpgradeNotice").classList.contains("is-switched-off")).toBe(true);
  research.click();
  expect(h.chip("techTreeNotice").classList.contains("is-switched-off")).toBe(true);
  expect(h.storage.values["wildstat-hud-research-ready-visible"]).toBe("false");
});
