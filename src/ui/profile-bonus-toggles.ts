import { ALL_BONUSES_ON, BONUS_TOGGLE_DETAILS, BONUS_TOGGLE_IDS, type BonusToggleId, type BonusToggles } from "../../shared/bonus-toggles";

/**
 * The profile's Bonuses tab (your own profile only): a switch for each bonus group, to play as an
 * account without it (shared/bonus-toggles.ts). Each switch applies on tap; the server's row, once it
 * arrives, is what the switches show.
 */
export type ProfileBonusDeps = {
  toggles: () => BonusToggles;
  setToggles: (next: BonusToggles) => Promise<{ ok?: boolean; error?: string } | undefined>;
  /** Why the switches can't move now (a challenge or a duel), or null. */
  locked: () => string | null;
};

type BonusSource = {
  bonusToggles?: () => BonusToggles; setBonusToggles?: (next: BonusToggles) => Promise<{ ok?: boolean; error?: string }>;
  prestigeChallenge?: () => { active?: boolean } | null; aggroChallenge?: () => { active?: boolean } | null;
  localIdentity?: () => string | undefined; researchInPlay?: () => object;
};

/** The tab's deps from the coop session, so the composition root wires it in one line. */
export function profileBonusDeps(coop: () => BonusSource | null | undefined, isDueling: () => boolean): ProfileBonusDeps {
  return {
    toggles: () => coop()?.bonusToggles?.() ?? { ...ALL_BONUSES_ON },
    setToggles: async next => coop()?.setBonusToggles?.(next),
    locked: () => coop()?.prestigeChallenge?.()?.active || coop()?.aggroChallenge?.()?.active ? "Bonuses can't be switched during a challenge."
      : isDueling() ? "Finish your duel before switching bonuses." : null,
  };
}

/** Your own profile with the research you switched off left out, as your stats and power read it; anyone else's as it is. */
export function ownProfileInPlay<T extends { identity: string; research: unknown }>(profile: T, coop: BonusSource | null | undefined): T {
  return coop && profile.identity === coop.localIdentity?.() ? { ...profile, research: coop.researchInPlay?.() ?? profile.research } : profile;
}

export function createProfileBonusToggles(panel: HTMLElement, deps: ProfileBonusDeps) {
  const doc = panel.ownerDocument;
  panel.innerHTML = `<p class="bonus-toggle-intro">Switch bonuses off to play as an account without them. Nothing is lost: switch them back on any time.</p>`
    + `<ul class="bonus-toggle-list"></ul><p class="bonus-toggle-status" role="status"></p>`;
  const list = panel.querySelector<HTMLUListElement>(".bonus-toggle-list")!;
  const status = panel.querySelector<HTMLElement>(".bonus-toggle-status")!;
  const switches = new Map<BonusToggleId, HTMLButtonElement>();
  let pending = false, shown = "", error = "";

  for (const id of BONUS_TOGGLE_IDS) {
    const row = doc.createElement("li");
    row.className = "bonus-toggle-row";
    const text = doc.createElement("div");
    text.className = "bonus-toggle-text";
    const label = doc.createElement("span");
    label.className = "bonus-toggle-label";
    label.id = `bonusToggle-${id}`;
    label.textContent = BONUS_TOGGLE_DETAILS[id].label;
    const detail = doc.createElement("span");
    detail.className = "bonus-toggle-detail";
    detail.textContent = BONUS_TOGGLE_DETAILS[id].detail;
    text.append(label, detail);
    const control = doc.createElement("button");
    control.type = "button";
    control.className = "pill-switch";
    control.setAttribute("role", "switch");
    control.setAttribute("aria-labelledby", label.id);
    control.innerHTML = `<span class="pill-switch-knob" aria-hidden="true"></span>`;
    control.addEventListener("click", () => { void flip(id); });
    switches.set(id, control);
    row.append(text, control);
    list.append(row);
  }

  async function flip(id: BonusToggleId) {
    if (pending || deps.locked()) return;
    const next = { ...deps.toggles(), [id]: !deps.toggles()[id] };
    pending = true; error = ""; render();
    // Shown at once; the server's row confirms it, or the failure puts it back.
    switches.get(id)!.setAttribute("aria-checked", String(next[id]));
    try {
      const result = await deps.setToggles(next);
      if (!result?.ok) error = result?.error || "Couldn't switch that. Try again.";
    } catch { error = "Couldn't switch that. Try again."; }
    finally { pending = false; shown = ""; render(); }
  }

  /** Called on every HUD tick while the profile is open: only a change touches the DOM. */
  function render() {
    const toggles = deps.toggles(), locked = deps.locked();
    const key = JSON.stringify([toggles, locked, pending, error]);
    if (key === shown) return;
    shown = key;
    for (const [id, control] of switches) {
      control.setAttribute("aria-checked", String(toggles[id]));
      control.disabled = pending || locked !== null;
    }
    status.textContent = locked ?? error;
  }

  render();
  return { render };
}
