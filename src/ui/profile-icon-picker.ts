import { profileIconLocation, profileIconsInCategory, type ProfileIconCategory } from "../../shared/profile-icons";

export function createProfileIconPicker(choices: HTMLElement, hooks: {
  selectedIcon: () => number;
  paintIcon: (element: HTMLElement, index: number) => void;
  setIcon: (index: number) => Promise<{ ok: boolean; error?: string } | undefined>;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const tabs = document.createElement("div"); tabs.className = "profile-icon-tabs";
  tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Profile pictures");
  choices.before(tabs); choices.setAttribute("role", "tabpanel");
  const buttons = new Map<ProfileIconCategory, HTMLButtonElement>();
  let category: ProfileIconCategory = "people", revision = 0, busy = false;
  function render() {
    for (const [key, button] of buttons) {
      button.setAttribute("aria-selected", String(category === key));
      button.tabIndex = category === key ? 0 : -1;
    }
    choices.setAttribute("aria-labelledby", `profile-icon-tab-${category}`);
    choices.replaceChildren();
    for (const index of profileIconsInCategory(category)) {
      const choice = document.createElement("button"); choice.type = "button"; choice.className = "profile-icon-choice";
      const selected = index === hooks.selectedIcon();
      choice.classList.toggle("is-selected", selected); choice.setAttribute("aria-pressed", String(selected));
      choice.setAttribute("aria-label", `Use ${category === "people" ? "person" : "object"} picture ${index + 1}`);
      choice.disabled = busy; hooks.paintIcon(choice, index);
      choice.addEventListener("click", async () => {
        if (busy) return;
        const version = revision; busy = true;
        choices.setAttribute("aria-busy", "true");
        choices.querySelectorAll("button").forEach(button => { button.disabled = true; });
        try {
          const result = await hooks.setIcon(index);
          if (version !== revision) return;
          if (result?.ok) hooks.onSaved();
          else hooks.onError(result?.error || "PROFILE ICON UPDATE FAILED");
        } catch { if (version === revision) hooks.onError("PROFILE ICON UPDATE FAILED"); }
        finally {
          if (version === revision) {
            busy = false; choices.removeAttribute("aria-busy");
            choices.querySelectorAll("button").forEach(button => { button.disabled = false; });
          }
        }
      });
      choices.append(choice);
    }
    choices.scrollTop = 0;
  }
  for (const key of ["people", "objects"] as const) {
    const button = document.createElement("button"); button.type = "button";
    button.id = `profile-icon-tab-${key}`; button.textContent = key === "people" ? "People" : "Objects";
    button.setAttribute("role", "tab"); button.setAttribute("aria-controls", choices.id);
    button.addEventListener("click", () => { category = key; render(); });
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); category = event.key === "Home" ? "people" : event.key === "End" ? "objects" : category === "people" ? "objects" : "people";
      render(); buttons.get(category)?.focus();
    });
    buttons.set(key, button); tabs.append(button);
  }
  return {
    open() { revision++; busy = false; choices.removeAttribute("aria-busy"); category = profileIconLocation(hooks.selectedIcon()).category; render(); },
    close() { revision++; busy = false; choices.removeAttribute("aria-busy"); },
  };
}
