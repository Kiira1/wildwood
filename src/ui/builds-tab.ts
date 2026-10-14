import { BUILD_GEAR_SLOTS, BUILD_SLOTS } from "../../shared/builds";
import type { SavedBuild } from "../../shared/builds";
import type { BuildActions } from "./build-actions";

/**
 * The Builds tab: three saved loadouts, each the gear in every slot and the cards in each item. Save Current
 * stores what is worn now (a second tap confirms over a saved build); Equip puts it all back on.
 */
export function createBuildsTab(options: {
  actions: BuildActions;
  itemName: (itemId: string) => string;
  showMessage: (text: string, color?: string) => void;
}) {
  const element = document.createElement("section");
  element.className = "builds-tab";
  element.hidden = true;
  const note = document.createElement("p");
  note.className = "inventory-cosmetics-note builds-tab-note";
  note.textContent = "Save what you wear and its cards, then swap back in one tap.";
  const list = document.createElement("div");
  list.className = "builds-tab-list";
  element.append(note, list);
  let busy = -1, armed = -1, renderedKey = "";

  const summary = (build: SavedBuild | null) => {
    if (!build) return "Empty";
    const names = BUILD_GEAR_SLOTS.map(slot => build.gear[slot]).filter(Boolean).map(options.itemName);
    const cards = Object.values(build.cards).reduce((sum, ids) => sum + ids.length, 0);
    return `${names.join(" · ") || "No gear"}${cards ? ` · ${cards} Card${cards === 1 ? "" : "s"}` : ""}`;
  };

  async function run(slot: number, kind: "save" | "equip") {
    if (busy >= 0) return;
    busy = slot; armed = -1; render(true);
    try {
      if (kind === "save") {
        const result = await options.actions.save(slot);
        options.showMessage(result.ok ? `Build ${slot + 1} Saved` : result.error ?? "Not Connected", result.ok ? "#72ef58" : "#ff9b91");
      } else {
        const result = await options.actions.equip(slot);
        const missing = result.missingGear ? ` · ${result.missingGear} Item${result.missingGear === 1 ? "" : "s"} Missing` : "";
        options.showMessage(result.ok ? `Build ${slot + 1} Equipped${missing}` : result.error ?? "Not Connected", result.ok ? "#72ef58" : "#ff9b91");
      }
    } finally { busy = -1; render(true); }
  }

  function render(force = false) {
    const builds = options.actions.builds();
    const key = JSON.stringify([builds, busy, armed]);
    if (!force && key === renderedKey) return;
    renderedKey = key;
    list.textContent = "";
    for (let slot = 0; slot < BUILD_SLOTS; slot += 1) {
      const build = builds[slot] ?? null;
      const card = document.createElement("div");
      card.className = "builds-tab-card";
      const title = document.createElement("strong");
      title.textContent = `Build ${slot + 1}`;
      const detail = document.createElement("span");
      detail.className = "builds-tab-detail";
      detail.textContent = summary(build);
      const actions = document.createElement("div");
      actions.className = "builds-tab-actions";
      const equip = document.createElement("button");
      equip.type = "button";
      equip.className = "builds-tab-equip";
      equip.textContent = busy === slot ? "Working…" : "Equip";
      equip.disabled = !build || busy >= 0;
      equip.addEventListener("click", () => { void run(slot, "equip"); });
      const save = document.createElement("button");
      save.type = "button";
      save.className = "builds-tab-save";
      save.textContent = armed === slot ? "Confirm Save" : "Save Current";
      save.disabled = busy >= 0;
      save.addEventListener("click", () => {
        if (build && armed !== slot) { armed = slot; render(true); return; }
        void run(slot, "save");
      });
      actions.append(equip, save);
      card.append(title, detail, actions);
      list.append(card);
    }
  }

  return {
    element,
    render: () => render(),
    show(visible: boolean) { element.hidden = !visible; if (visible) render(); else if (armed >= 0) { armed = -1; render(true); } },
  };
}
