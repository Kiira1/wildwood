import { MAP_IDS, MAP_DISPLAY_NAMES, numberedMapName } from "../../shared/rules";
import { CAMPAIGN_UNLOCK_FIELDS, type CampaignAccess } from "../../shared/equipment-access";
import { proceduralMapId } from "../../shared/procedural-maps";
import type { MapId } from "../game/world";

/** A single Home portal, using the same authoritative unlocks as ordinary travel. */
export function createHomeTravelController(deps: {
  progress: () => CampaignAccess | null | undefined;
  endlessUnlocked: (mapId: string) => boolean;
  travel: (mapId: MapId) => Promise<boolean>;
  pause: (paused: boolean) => void;
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "home-travel-dialog";
  dialog.setAttribute("aria-labelledby", "homeTravelTitle");
  dialog.innerHTML = `<h2 id="homeTravelTitle">Travel</h2><div class="home-travel-maps"></div>
    <form class="home-travel-endless" hidden><label>Endless <input type="number" min="1" step="1" value="1" inputmode="numeric" required aria-label="Endless map number"></label><button class="secondary-button" type="submit">Go</button></form>
    <p class="home-travel-status" role="status"></p><button type="button" class="window-back-button">Back</button>`;
  document.body.append(dialog);
  const list = dialog.querySelector<HTMLDivElement>(".home-travel-maps")!;
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  const input = form.querySelector("input")!;
  const status = dialog.querySelector<HTMLElement>(".home-travel-status")!;
  let pending = false;
  function close() { dialog.close(); deps.pause(false); }
  async function travel(map: MapId) {
    if (pending) return;
    pending = true; close();
    try {
      if (!await deps.travel(map)) { open(); status.textContent = "Travel unavailable. Try again."; }
    } catch { open(); status.textContent = "Travel unavailable. Try again."; }
    finally { pending = false; }
  }
  function open() {
    list.replaceChildren(); status.textContent = "";
    const progress = deps.progress();
    MAP_IDS.forEach((mapId, index) => {
      if (index > 0 && !progress?.[CAMPAIGN_UNLOCK_FIELDS[index - 1]]) return;
      const button = document.createElement("button");
      button.type = "button"; button.className = "home-travel-map";
      button.textContent = numberedMapName(mapId, MAP_DISPLAY_NAMES[mapId as keyof typeof MAP_DISPLAY_NAMES]);
      button.addEventListener("click", () => { void travel(mapId as MapId); });
      list.append(button);
    });
    form.hidden = !deps.endlessUnlocked(proceduralMapId(1));
    deps.pause(true); if (!dialog.open) dialog.showModal();
  }
  form.addEventListener("submit", event => {
    event.preventDefault(); const number = Number(input.value);
    if (!Number.isSafeInteger(number) || number < 1 || !deps.endlessUnlocked(proceduralMapId(number))) {
      status.textContent = "That map is not unlocked yet."; return;
    }
    void travel(proceduralMapId(number));
  });
  dialog.querySelector(".window-back-button")!.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  return { open, close };
}
