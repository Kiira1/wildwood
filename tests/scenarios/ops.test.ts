import { describe, expect, it } from "vitest";
import { bootGame, gameWorld, storageKeys, type GameTab } from "./harness/game";
import { GAME_VERSION } from "../../src/game/runtime/game-settings";
import { freeze, idle } from "./harness/boot-ops";

const NEXT_VERSION = GAME_VERSION.replace(/\d+$/, n => String(Number(n) + 1));

/** The site's version.json, as the CDN serves it: `live` is what it says, `checks` counts the requests. */
function deployedVersion(live = GAME_VERSION) {
  const site = { live, checks: 0 };
  const route = (url: URL) => {
    if (url.pathname !== "/version.json") return null;
    site.checks++;
    return new Response(JSON.stringify({ version: site.live }), { headers: { "content-type": "application/json" } });
  };
  return { site, route };
}

/** The forced-update handoff this tab left for the page it reloads into, if any. */
const handoff = (tab: GameTab) => tab.sessionStorage.getItem(storageKeys.updateResumeKey);
const press = (tab: GameTab, element: HTMLElement) => element.dispatchEvent(new (tab.window as any).Event("click", { bubbles: true }));
const versionIn = (url: string) => new URL(url).searchParams.get("v");

async function returningGuest(route: (url: URL) => Response | null) {
  const world = gameWorld();
  world.join("Ann").disconnect();
  const tab = await bootGame(world, { name: "Ann", route });
  if (!await tab.until(tab.playing, 20_000)) throw new Error("Never reached the world");
  return { world, tab };
}

describe("updates and releases", () => {
  it("OPS-01 BOOT-14 an open tab moves to a new build once, after its session handoff, which an old cached bundle leaves alone; hidden tabs and stale CDN answers wait", async () => {
    const { site, route } = deployedVersion();
    let { tab } = await returningGuest(route);

    // The CDN briefly serves an older version.json: the visible tab's poll sees it and does nothing.
    site.live = "0.1.0";
    const firstChecks = site.checks;
    await idle(tab, 16 * 60_000);
    expect(site.checks).toBeGreaterThan(firstChecks);
    expect(tab.navigations).toEqual([]);

    // A hidden tab is never polled, however long a new build has been out (frozen most of the time, then running).
    site.live = NEXT_VERSION;
    tab.setHidden(true);
    const checksBefore = site.checks;
    freeze(tab, 20 * 60_000);
    await idle(tab, 2 * 60_000);
    expect(site.checks).toBe(checksBefore);
    expect(tab.navigations).toEqual([]);

    // Back after a long absence: checked at once, the session handed off, then the move to the new build.
    tab.setHidden(false);
    expect(await tab.until(() => tab.navigations.length > 0, 10_000)).toBe(true);
    expect(tab.navigations).toHaveLength(1);
    expect(versionIn(tab.navigations[0].url)).toBe(NEXT_VERSION);
    expect(handoff(tab)).toBeTruthy();

    // An old cached bundle loads at that address: it plays on, leaves the handoff for the real new build, and does not reload again.
    tab = await tab.follow();
    expect(await tab.until(tab.playing, 20_000)).toBe(true);
    expect(versionIn(tab.location.href)).toBe(NEXT_VERSION);
    await idle(tab, 2 * 60_000);
    expect(tab.navigations).toEqual([]);
    expect(handoff(tab)).toBeTruthy();
  }, 60_000);

  it("OPS-01 a session the server refuses on a current build reconnects fresh; refused again, it backs off, reloads once and never loops", async () => {
    const { route } = deployedVersion();
    let { world, tab } = await returningGuest(route);
    const ann = world.player("Ann");
    // The server loses sessions: `refusing` drops each new one as soon as it registers.
    let refusing = false;
    const dropSession = (connectionId: unknown) => world.setup(ctx => ctx.db.playerSession.connectionId.delete(connectionId));
    world.onCommit(commit => { if (refusing && commit.reducer === "registerClientVersion" && commit.sender.toHexString() === ann.hex) queueMicrotask(() => dropSession(commit.connectionId)); });

    // Lost once (a database restart): the update screen, then after the grace a fresh session, and play goes on.
    dropSession(tab.connection()!.connectionId);
    tab.tap("townBtn");
    await tab.play(1_000);
    expect(tab.shown("reconnectOverlay")).toBe(true);
    await idle(tab, 45_000);
    expect(tab.shown("reconnectOverlay")).toBe(false);
    expect(tab.playing()).toBe(true);
    expect(tab.navigations).toEqual([]);

    // Lost on every connection: fresh tries, spaced out, then one reload carrying the session.
    refusing = true;
    const connectionsBefore = tab.network.connections.length;
    dropSession(tab.connection()!.connectionId);
    tab.tap("townBtn");
    await idle(tab, 30_000);
    expect(tab.navigations).toEqual([]);
    await idle(tab, 3 * 60_000);
    expect(tab.network.connections.length - connectionsBefore).toBeGreaterThanOrEqual(2);
    expect(tab.navigations).toHaveLength(1);
    expect(versionIn(tab.navigations[0].url)).toBe(GAME_VERSION);
    expect(handoff(tab)).toBeTruthy();

    // The reloaded page is refused too: it keeps trying fresh connections but does not reload inside the cooldown.
    // BOOT-14: the bundle of that version takes the handoff, once, and resumes as the same player.
    tab = await tab.follow();
    expect(handoff(tab)).toBeNull();
    expect(tab.connection()!.fake.player.name).toBe("Ann");
    expect(await tab.until(() => tab.shown("reconnectOverlay"), 20_000)).toBe(true);
    // The version marker comes off the address once that version has loaded.
    expect(versionIn(tab.location.href)).toBeNull();
    await idle(tab, 3 * 60_000);
    expect(tab.navigations).toEqual([]);
    expect(tab.shown("reconnectOverlay")).toBe(true);
  }, 60_000);

  it("OPS-01 the Android app says a downloaded update is waiting, restarts into it on request, and reports its updater state once per change", async () => {
    const world = gameWorld();
    world.join("Ann").disconnect();
    const tab = await bootGame(world, { name: "Ann" });
    // The app's updater, as the Android shell exposes it to the page.
    let state = { channel: "production", current: "Installed app", pending: null as string | null, message: "Updates apply on the next app launch.", busy: false, developer: false };
    let restarts = 0;
    Object.defineProperty(tab.window, "wildstatUpdates", { configurable: true, value: { snapshot: () => state, applyNow: async () => { restarts++; }, check: async () => {}, selectChannel: async () => {}, rollback: async () => {}, setDeveloperAccess: () => {} } });
    const updater = (next: Partial<typeof state>) => { state = { ...state, ...next }; tab.document.defaultView!.dispatchEvent(new (tab.window as any).Event("wildstat:ota-changed")); };
    expect(await tab.until(tab.playing, 20_000)).toBe(true);
    const banner = () => tab.shown("appUpdateReadyBanner");
    const buttons = () => [...tab.element("appUpdateReadyBanner").querySelectorAll("button")] as HTMLElement[];
    expect(banner()).toBe(false);

    updater({ pending: "android-0.917.0-abc", message: "Ready." });
    expect(banner()).toBe(true);
    const [restart, later] = buttons();
    press(tab, restart);
    await tab.play(100);
    expect(restarts).toBe(1);
    press(tab, later);
    expect(banner()).toBe(false);
    // A newer download shows again; going back to the installed app is no news.
    updater({ pending: "android-0.917.1-def" });
    expect(banner()).toBe(true);
    updater({ pending: "Installed app" });
    expect(banner()).toBe(false);

    // Each distinct updater state reaches the server once, not while it is busy downloading.
    updater({ busy: true, message: "Downloading update…" });
    updater({ busy: false, message: "Recovered to the installed app." });
    updater({});
    await tab.play(40_000);
    const reports = [...world.db.connectionDiagnostic.iter()].filter(row => row.kind === "app-update").map(row => JSON.parse(row.detailsJson).detail as string);
    expect(reports.filter(detail => detail.includes("Downloading"))).toEqual([]);
    expect(new Set(reports).size).toBe(reports.length);
    expect(reports.some(detail => detail.includes("Recovered to the installed app."))).toBe(true);
  }, 60_000);
});

