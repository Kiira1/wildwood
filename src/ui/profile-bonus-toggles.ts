import { BONUS_GROUP_IDS, BONUS_GROUPS, BONUS_ITEM_IDS, bonusGroupIds, bonusGroupState, withBonus, type BonusGroupId, type BonusOff } from "../../shared/bonus-toggles";

/**
 * The profile's Bonuses tab (your own profile only): one switch for every bonus at once, then a
 * dropdown a group, each with a switch for the whole group and one a bonus inside it
 * (shared/bonus-toggles.ts). A switch applies on tap; the server's row, once it arrives, is what the
 * switches show. A group or the whole list partly off shows its switch halfway.
 */
export type ProfileBonusDeps = {
  /** The bonus item ids switched off. */
  off: () => readonly string[];
  setOff: (ids: readonly string[]) => Promise<{ ok?: boolean; error?: string } | undefined>;
  /** Why the switches can't move now (a challenge or a duel), or null. */
  locked: () => string | null;
};

type BonusSource = {
  bonusOff?: () => readonly string[]; setBonusOff?: (ids: readonly string[]) => Promise<{ ok?: boolean; error?: string }>;
  prestigeChallenge?: () => { active?: boolean } | null; aggroChallenge?: () => { active?: boolean } | null;
  localIdentity?: () => string | undefined; researchInPlay?: () => object;
};

/** The tab's deps from the coop session, so the composition root wires it in one line. */
export function profileBonusDeps(coop: () => BonusSource | null | undefined, isDueling: () => boolean): ProfileBonusDeps {
  return {
    off: () => coop()?.bonusOff?.() ?? [],
    setOff: async ids => coop()?.setBonusOff?.(ids),
    locked: () => coop()?.prestigeChallenge?.()?.active || coop()?.aggroChallenge?.()?.active ? "Bonuses can't be switched during a challenge."
      : isDueling() ? "Finish your duel before switching bonuses." : null,
  };
}

/** Your own profile with the research you switched off left out, as your stats and power read it; anyone else's as it is. */
export function ownProfileInPlay<T extends { identity: string; research: unknown }>(profile: T, coop: BonusSource | null | undefined): T {
  return coop && profile.identity === coop.localIdentity?.() ? { ...profile, research: coop.researchInPlay?.() ?? profile.research } : profile;
}

type SwitchState = "on" | "off" | "mixed";
const allState = (off: BonusOff): SwitchState => off.size === 0 ? "on" : BONUS_ITEM_IDS.every(id => off.has(id)) ? "off" : "mixed";

export function createProfileBonusToggles(panel: HTMLElement, deps: ProfileBonusDeps) {
  const doc = panel.ownerDocument;
  panel.innerHTML = `<p class="bonus-toggle-intro">Switch bonuses off to play as an account without them. Nothing is lost: switch them back on any time.</p>`
    + `<div class="bonus-toggle-all"></div><div class="bonus-toggle-groups"></div><p class="bonus-toggle-status" role="status"></p>`;
  const status = panel.querySelector<HTMLElement>(".bonus-toggle-status")!;
  /** Every switch, with the ids it sets and how to read its state. */
  const controls: { button: HTMLButtonElement; state: (off: BonusOff) => SwitchState }[] = [];
  const counts = new Map<BonusGroupId, HTMLElement>();
  let pending: Set<string> | null = null, shown = "", error = "";

  function pillSwitch(labelId: string, ids: readonly string[], state: (off: BonusOff) => SwitchState) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "pill-switch";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-labelledby", labelId);
    button.innerHTML = `<span class="pill-switch-knob" aria-hidden="true"></span>`;
    // On (or partly on) turns them all off; off turns them all on.
    button.addEventListener("click", () => { void apply(ids, state(current()) === "off"); });
    controls.push({ button, state });
    return button;
  }
  function textBlock(id: string, label: string, detail: string, labelClass = "bonus-toggle-label") {
    const text = doc.createElement("div");
    text.className = "bonus-toggle-text";
    const name = doc.createElement("span");
    name.className = labelClass; name.id = id; name.textContent = label;
    const note = doc.createElement("span");
    note.className = "bonus-toggle-detail"; note.textContent = detail;
    text.append(name, note);
    return { text, note };
  }

  // One switch for everything.
  const all = panel.querySelector<HTMLElement>(".bonus-toggle-all")!;
  all.className = "bonus-toggle-row bonus-toggle-all";
  all.append(textBlock("bonusToggle-all", "All Bonuses", "Every bonus below at once").text, pillSwitch("bonusToggle-all", BONUS_ITEM_IDS, allState));

  const groups = panel.querySelector<HTMLElement>(".bonus-toggle-groups")!;
  for (const group of BONUS_GROUP_IDS) {
    const details = BONUS_GROUPS[group];
    const card = doc.createElement("section");
    card.className = "bonus-toggle-group";
    const head = doc.createElement("div");
    head.className = "bonus-toggle-row bonus-toggle-group-head";
    const expand = doc.createElement("button");
    expand.type = "button";
    expand.className = "bonus-toggle-expand";
    expand.setAttribute("aria-expanded", "false");
    expand.setAttribute("aria-controls", `bonusToggleList-${group}`);
    const { text, note } = textBlock(`bonusToggle-${group}`, details.label, details.detail);
    counts.set(group, note);
    const caret = doc.createElement("span");
    caret.className = "bonus-toggle-caret"; caret.setAttribute("aria-hidden", "true");
    expand.append(caret, text);
    const list = doc.createElement("ul");
    list.className = "bonus-toggle-list"; list.id = `bonusToggleList-${group}`; list.hidden = true;
    expand.addEventListener("click", () => {
      list.hidden = !list.hidden;
      expand.setAttribute("aria-expanded", String(!list.hidden));
      card.classList.toggle("is-open", !list.hidden);
    });
    head.append(expand, pillSwitch(`bonusToggle-${group}`, bonusGroupIds(group), off => bonusGroupState(off, group)));
    for (const item of details.items) {
      const row = doc.createElement("li");
      row.className = "bonus-toggle-row bonus-toggle-item";
      const labelId = `bonusToggle-${item.id.replace(".", "-")}`;
      row.append(textBlock(labelId, item.label, item.detail, "bonus-toggle-item-label").text, pillSwitch(labelId, [item.id], off => off.has(item.id) ? "off" : "on"));
      list.append(row);
    }
    card.append(head, list);
    groups.append(card);
  }

  /** What the switches show: the change being sent, or the server's row. */
  const current = (): BonusOff => pending ?? new Set(deps.off());

  async function apply(ids: readonly string[], on: boolean) {
    if (pending || deps.locked()) return;
    const next = withBonus(current(), ids, on);
    pending = next; error = ""; render();
    try {
      const result = await deps.setOff([...next]);
      if (!result?.ok) error = result?.error || "Couldn't switch that. Try again.";
    } catch { error = "Couldn't switch that. Try again."; }
    finally { pending = null; render(); }
  }

  /** Called on every HUD tick while your profile is open: only a change touches the DOM. */
  function render() {
    const off = current(), locked = deps.locked();
    const key = JSON.stringify([[...off].sort(), locked, Boolean(pending), error]);
    if (key === shown) return;
    shown = key;
    for (const { button, state } of controls) {
      const value = state(off);
      button.setAttribute("aria-checked", value === "mixed" ? "mixed" : String(value === "on"));
      button.disabled = Boolean(pending) || locked !== null;
    }
    for (const [group, note] of counts) {
      const offHere = bonusGroupIds(group).filter(id => off.has(id)).length;
      note.textContent = offHere ? `${offHere} of ${bonusGroupIds(group).length} off` : BONUS_GROUPS[group].detail;
    }
    status.textContent = locked ?? error;
  }

  render();
  return { render };
}
