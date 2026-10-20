import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { MAP_IDS } from "../../shared/rules";
import { CAMPAIGN_UNLOCK_FIELDS } from "../../shared/equipment-access";
import type { MapId } from "../game/world";
import { createMapGuideController, mapGuideNextGoal, mapGuideTravelButton, MAP_GUIDE_PORTAL_HINT, type MapGuideProgress } from "./map-guide-controller";

const NAMES: Record<string, string> = { tutorial_forest: "Tutorial Forest", beginner_desert: "Beginner Desert", intermediate_snowlands: "Intermediate Snowlands", advanced_lava_wastes: "Advanced Lava Wastes" };
const mapName = (mapId: MapId) => NAMES[mapId] ?? "";
/** The first `campaign` maps open, then `endless` Endless stages. */
const opened = (campaign: number, endless = 0) => (mapId: MapId) => {
  const stage = /^endless_(\d+)$/.exec(mapId);
  return stage ? Number(stage[1]) <= endless : MAP_IDS.indexOf(mapId as never) < campaign;
};
const progress = (level: number, campaignDone: boolean, completed: number): MapGuideProgress => ({
  prestige: () => ({ level }), prestigeCampaignComplete: () => campaignDone, proceduralCompleted: () => completed,
});

describe("the Map Guide's Next Goal", () => {
  it("names the boss that opens the next campaign map, as the Travel picker does", () => {
    expect(mapGuideNextGoal(opened(1), mapName).goal).toBe("Defeat the Dragon in Tutorial Forest to unlock Beginner Desert");
    expect(mapGuideNextGoal(opened(3), mapName)).toEqual({ goal: "Defeat Frostclaw in Intermediate Snowlands to unlock Advanced Lava Wastes", prestige: "" });
    expect(CAMPAIGN_UNLOCK_FIELDS.length).toBe(MAP_IDS.length - 1);
  });

  it("asks for the last boss to open Endless, with Prestige's requirement once the campaign is open", () => {
    const goal = mapGuideNextGoal(opened(MAP_IDS.length), mapName, progress(0, false, 0), true);
    expect(goal.goal).toBe("Defeat Aegis Prime in Ion Citadel to unlock Endless");
    expect(goal.prestige).toBe("Defeat Aegis Prime to unlock Prestige");
  });

  it("names the next Endless stage, and what the next Prestige needs", () => {
    const goal = mapGuideNextGoal(opened(MAP_IDS.length, 4), mapName, progress(2, true, 1), true);
    expect(goal.goal).toBe("Defeat the Endless 4 boss to unlock Endless 5");
    expect(goal.prestige).toBe("Clear the Endless 2 boss to prestige");
    expect(mapGuideNextGoal(opened(MAP_IDS.length, 4), mapName, progress(1, true, 3), true).prestige).toBe("Prestige is ready in your Profile");
  });
});

describe("the Map Guide's Travel button", () => {
  it("is not shown on the player's own map, is Locked past the open ones, and goes by the Town from elsewhere", () => {
    expect(mapGuideTravelButton("beginner_desert", "beginner_desert", true, false)).toBeNull();
    expect(mapGuideTravelButton("advanced_lava_wastes", "town", false, true)).toEqual({ label: "Locked", disabled: true });
    expect(mapGuideTravelButton("beginner_desert", "town", true, true)).toEqual({ label: "Travel", disabled: false });
    expect(mapGuideTravelButton("tutorial_forest", "beginner_desert", true, false)).toEqual({ label: "Travel From Town", disabled: false });
  });
});

describe("the Map Guide window", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  function setup(current: MapId, inTownAtFirst: boolean, teleportReady = true) {
    const { document, window } = parseHTML(`<html><body><button id="trigger"></button><div id="mapGuide" hidden>
      <button id="mapGuidePrev"></button><p id="mapGuideKicker"></p><h2 id="title"></h2><button id="mapGuideNext"></button>
      <div class="map-guide-content"><div><canvas id="canvas"></canvas><div id="zones"></div></div>
      <section><table><tbody id="mapGuideEnemyRows"></tbody></table></section><section><header><h3>Item Drops</h3></header><div id="drops"></div></section></div>
      <button id="back"></button></div></body></html>`);
    vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", window.HTMLElement);
    vi.stubGlobal("ResizeObserver", class { observe() {} });
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const canvas = document.getElementById("canvas") as unknown as HTMLCanvasElement;
    Object.assign(canvas, { getContext: () => null, getBoundingClientRect: () => ({ width: 100, height: 100 }) });
    const state = { current, inTown: inTownAtFirst };
    const prefer = vi.fn(), teleportToTown = vi.fn(() => teleportReady);
    const get = <T>(id: string) => document.getElementById(id) as unknown as T;
    const guide = createMapGuideController({
      trigger: get("trigger"), overlay: get("mapGuide"), title: get("title"), canvas, zoneLabels: get("zones"), dropItems: get("drops"), back: get("back"),
    }, {
      currentMapId: () => state.current, mapName: id => NAMES[id] ?? id, paths: [], spawnSites: [], player: { x: 0, y: 0 },
      boss: () => null, portals: () => [], beforeOpen: () => {}, clearPlayerInput: () => {},
      mapUnlocked: opened(3), power: () => 4_200_000,
      travel: { inTown: () => state.inTown, prefer, teleportToTown },
    });
    const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as unknown as T;
    const click = (selector: string) => q(selector).dispatchEvent(new window.Event("click", { bubbles: true }));
    return { guide, state, prefer, teleportToTown, q, click };
  }

  it("shows the Next Goal and the shown map's recommended power at the top", () => {
    const s = setup("beginner_desert", false);
    s.guide.open();
    const block = s.q(".map-guide-content > .map-guide-goal");
    expect(block.querySelector("h3")!.textContent).toBe("Next Goal");
    expect(s.q(".map-guide-goal-text").textContent).toBe("Defeat Frostclaw in Intermediate Snowlands to unlock Advanced Lava Wastes");
    expect(s.q(".map-guide-goal-power").textContent).toMatch(/^Your Power 4\.20m · Recommended \S+$/);
    // On the player's own map there is nothing to travel to.
    expect(s.q<HTMLElement>(".map-guide-travel").hidden).toBe(true);
  });

  it("from a map, presses the Town button and points to the Travel portal once there, the picker set on the map", async () => {
    vi.useFakeTimers();
    const s = setup("beginner_desert", false);
    s.guide.open();
    s.click("#mapGuidePrev");
    expect(s.q(".map-guide-travel-button").textContent).toBe("Travel From Town");
    s.click(".map-guide-travel-button");
    expect(s.teleportToTown).toHaveBeenCalledTimes(1);
    expect(s.prefer).toHaveBeenCalledWith("tutorial_forest");
    expect(s.q(".map-guide-travel-hint").textContent).toBe(`Going to Town. ${MAP_GUIDE_PORTAL_HINT}. It opens on Tutorial Forest.`);
    Object.assign(s.state, { current: "town", inTown: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(s.q(".map-guide-travel-button").textContent).toBe("Travel");
    expect(s.q(".map-guide-travel-hint").textContent).toBe(`${MAP_GUIDE_PORTAL_HINT}. It opens on Tutorial Forest.`);
  });

  it("in Town, sets the picker and points to the portal without teleporting; says so while the Town button cools down", () => {
    const s = setup("town", true);
    s.guide.open();
    expect(s.q(".map-guide-travel-button").textContent).toBe("Travel");
    s.click(".map-guide-travel-button");
    expect(s.teleportToTown).not.toHaveBeenCalled();
    expect(s.prefer).toHaveBeenCalledWith("intermediate_snowlands");
    expect(s.q(".map-guide-travel-hint").textContent).toContain(MAP_GUIDE_PORTAL_HINT);
    const cooling = setup("beginner_desert", false, false);
    cooling.guide.open();
    cooling.click("#mapGuidePrev");
    cooling.click(".map-guide-travel-button");
    expect(cooling.q(".map-guide-travel-hint").textContent).toBe("The Town teleport is cooling down. Try again in a moment.");
  });

  it("locks the button on the map past the furthest open", () => {
    const s = setup("intermediate_snowlands", false);
    s.guide.open();
    s.click("#mapGuideNext");
    const button = s.q<HTMLButtonElement>(".map-guide-travel-button");
    expect([button.textContent, button.disabled]).toEqual(["Locked", true]);
    s.click(".map-guide-travel-button");
    expect(s.teleportToTown).not.toHaveBeenCalled();
  });
});
