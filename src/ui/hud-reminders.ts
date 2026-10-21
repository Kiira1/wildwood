import { renderBooleanSetting } from "./settings";

export type HudReminderKind = "research" | "smith";
/** The chips: the Tech Tree shows Research Ready, the gear sellers show when an Upgrade All has gear to buy. */
export const HUD_REMINDERS: readonly { kind: HudReminderKind; id: string; text: string; label: string; key: string }[] = [
  { kind: "research", id: "researchReadyHint", text: "Research Ready", label: "Research Ready Hint", key: "wildstat-hud-research-ready-visible" },
  { kind: "smith", id: "smithBuyNotice", text: "Gear Upgrades In Town", label: "Gear Upgrades Hint", key: "wildstat-hud-smith-upgrades-visible" },
];

/** The chips' markup, hidden until their owner says there is something to do. */
export function hudReminderMarkup() {
  return HUD_REMINDERS.map(reminder => `<button id="${reminder.id}" class="hud-reminder" type="button" hidden>${reminder.text}</button>`).join("");
}

/**
 * Research Ready and gear upgrades as readable chips in the timer column. A tap
 * away from the Town teleports there through the Town button, cooldown and all
 * (Research Ready lands inside the Research building, from the Town too). Each has a Settings switch, on by default.
 */
export function installHudReminders(options: {
  column: HTMLElement;
  before?: HTMLElement | null;
  townButton: HTMLButtonElement;
  settingsPanel: HTMLElement;
  inTown: () => boolean;
  /** Research Ready's tap: into the Research building; false when it cannot go now. */
  goToResearch?: () => boolean;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
}) {
  const doc = options.column.ownerDocument;
  const anchor = options.settingsPanel.querySelector("#statTrackerToggle")?.closest(".setting-row");
  for (const reminder of HUD_REMINDERS) {
    const chip = doc.getElementById(reminder.id);
    if (!chip) continue;
    if (options.before?.parentElement === options.column) options.before.before(chip); else options.column.append(chip);
    chip.addEventListener("click", () => {
      if (reminder.kind === "research" && options.goToResearch?.()) return;
      if (!options.inTown()) options.townButton.click();
    });
    let shown = true;
    try { shown = options.storage?.getItem(reminder.key) !== "false"; } catch { /* Use the default. */ }
    const row = doc.createElement("div");
    row.className = "setting-row";
    const label = doc.createElement("span");
    label.textContent = reminder.label;
    const button = doc.createElement("button");
    button.className = "setting-toggle";
    button.type = "button";
    button.setAttribute("aria-label", reminder.label);
    const paint = () => { renderBooleanSetting(button, shown); chip.classList.toggle("is-switched-off", !shown); };
    button.addEventListener("click", () => {
      shown = !shown;
      try { options.storage?.setItem(reminder.key, String(shown)); } catch { /* Holds for the session. */ }
      paint();
    });
    paint();
    row.append(label, button);
    if (anchor) anchor.before(row); else options.settingsPanel.append(row);
  }
  // In the Town a tap would go nowhere, so the chips stop looking tappable there; Research Ready still goes in.
  const markTown = () => {
    const town = options.inTown();
    for (const reminder of HUD_REMINDERS) {
      const stays = reminder.kind === "research" && Boolean(options.goToResearch);
      doc.getElementById(reminder.id)?.classList.toggle("is-in-town", town && !stays);
    }
  };
  markTown();
  return { refresh: markTown };
}
