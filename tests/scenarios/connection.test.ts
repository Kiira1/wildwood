import { describe, expect, it } from "vitest";
import { bootGame, gameWorld, type GameTab } from "./harness/game";
import { returnFromAnotherSite } from "./harness/boot-ops";

/** The full reconnect overlay is up (a quiet reconnect shows only a small badge in its place). */
const fullOverlay = (tab: GameTab) => tab.shown("reconnectOverlay") && !tab.coop.isReconnectingQuietly();
/** Plays `ms` and says whether the full reconnect overlay was on screen at any frame of it. */
async function overlaySeenDuring(tab: GameTab, ms: number) {
  let seen = false;
  for (let waited = 0; waited < ms; waited += 50) {
    await tab.play(50);
    seen ||= fullOverlay(tab);
  }
  return seen;
}

/** A returning guest in the world, with a switch that refuses every new connection and counts the tries. */
async function returningGuest(world = gameWorld()) {
  if (!world.db.playerLegalConsent.iter().next().value) world.join("Ann").disconnect();
  const network = { refusing: false, attempts: [] as number[] };
  /** `hold` set: the server accepts sockets but answers nothing on them. */
  const client: { hold?: boolean } = {};
  const tab = await bootGame(world, { name: "Ann", client, refuse: () => {
    if (!network.refusing) return null;
    network.attempts.push(Date.now());
    return new Error("connection refused");
  } });
  if (!await tab.until(tab.playing, 20_000)) throw new Error("Never reached the world");
  await tab.play(1_000);
  return { world, tab, network, client, ann: world.player("Ann") };
}

describe("connection", () => {
  it("BOOT-11 a tab switch keeps its socket, a phone that slept reconnects quietly, and a drop in view is shown and mended", async () => {
    const { tab } = await returningGuest();
    const first = tab.connection();

    // Four minutes on another tab with the socket alive: the same session, nothing shown on return.
    tab.setHidden(true);
    await tab.play(240_000);
    tab.setHidden(false);
    expect(await overlaySeenDuring(tab, 3_000)).toBe(false);
    expect(tab.connection()).toBe(first);
    expect(tab.playing()).toBe(true);

    // The phone sleeps and the OS closes the socket: on return it reconnects with no overlay.
    tab.setHidden(true);
    await tab.play(2_000);
    first!.fake.drop(new Error("socket closed in the background"));
    await tab.play(30_000);
    tab.setHidden(false);
    expect(await overlaySeenDuring(tab, 3_000)).toBe(false);
    expect(tab.connection()).not.toBe(first);
    expect(tab.playing()).toBe(true);
    expect(tab.connection()!.fake.player.name).toBe("Ann");

    // Restored from the back-forward cache with only pagehide/pageshow (no visibilitychange): mended too.
    const third = tab.connection();
    tab.window.dispatchEvent(new (tab.window as any).Event("pagehide"));
    third!.fake.drop(new Error("page frozen"));
    await tab.play(30_000);
    returnFromAnotherSite(tab);
    expect(await tab.until(() => tab.connection() !== third && tab.playing(), 5_000)).toBe(true);

    // The socket drops while the player watches: they are told, and it mends itself.
    const second = tab.connection();
    second!.fake.drop(new Error("network blip"));
    await tab.play(100);
    expect(fullOverlay(tab)).toBe(true);
    expect(await tab.until(() => tab.playing() && !tab.shown("reconnectOverlay"), 10_000)).toBe(true);
    expect(tab.connection()).not.toBe(second);
    expect(tab.navigations).toEqual([]);
  }, 60_000);

  it("BOOT-12 a long stall keeps the overlay up and retries ever more slowly but never stops; a lost presence is re-entered once", async () => {
    const { tab, network, client } = await returningGuest();
    network.refusing = true;
    tab.connection()!.fake.drop(new Error("server unreachable"));
    let overlayAlways = true;
    for (let waited = 0; waited < 180_000; waited += 1_000) {
      await tab.play(1_000);
      // Reconnecting, never "updating": only a confirmed protocol mismatch shows the update gate.
      overlayAlways &&= fullOverlay(tab) && !tab.shown("gameUpdateGate");
    }
    expect(overlayAlways).toBe(true);
    const gaps = network.attempts.slice(1).map((at, i) => at - network.attempts[i]);
    expect(gaps.length).toBeGreaterThan(3);
    // Backing off: the later waits are longer than the first, and retries keep coming in the last minute.
    expect(Math.max(...gaps.slice(-3))).toBeGreaterThan(gaps[0] * 2);
    expect(network.attempts.filter(at => at > Date.now() - 60_000).length).toBeGreaterThan(0);

    network.refusing = false;
    expect(await tab.until(tab.playing, 90_000)).toBe(true);
    await tab.play(1_000);
    expect(tab.shown("reconnectOverlay")).toBe(false);

    // A socket that opens but whose session never answers is given up on and replaced, then recovers.
    client.hold = true;
    const stalled = tab.connection()!;
    stalled.fake.drop(new Error("server unreachable"));
    await tab.play(60_000);
    expect(tab.network.connections.indexOf(tab.connection()!) - tab.network.connections.indexOf(stalled)).toBeGreaterThan(1);
    expect(tab.playing()).toBe(false);
    client.hold = false;
    tab.connection()!.fake.release();
    expect(await tab.until(tab.playing, 30_000)).toBe(true);
    expect(tab.navigations).toEqual([]);

  }, 60_000);

  it("BOOT-12 a session whose presence the server lost re-enters the world once and retries the refused action", async () => {
    const { tab, ann } = await returningGuest();
    const connection = tab.connection()!;
    const before = connection.fake.calls.length;
    tab.world.setup(ctx => ctx.db.player.identity.delete(ann.identity));
    expect(await tab.until(() => Boolean(ann.row("player")), 60_000)).toBe(true);
    await tab.play(5_000);
    const after = connection.fake.calls.slice(before);
    expect(after.filter(call => call.reducer === "enterWorldWithTutorial")).toHaveLength(1);
    const refused = after.findIndex(call => call.error);
    expect(refused).toBeGreaterThanOrEqual(0);
    // The refused action went through on its retry.
    expect(after.slice(refused + 1).some(call => call.reducer === after[refused].reducer && !call.error)).toBe(true);
    expect(tab.connection()).toBe(connection);
    expect(tab.playing()).toBe(true);
  }, 60_000);

  it("BOOT-13 a tab back from the background offers Retry at once and Reload after 30 s, never reloading by itself", async () => {
    const { tab, network } = await returningGuest();
    // Back from a minute away, the server cannot be reached.
    tab.setHidden(true);
    await tab.play(60_000);
    tab.setHidden(false);
    network.refusing = true;
    tab.connection()!.fake.drop(new Error("server unreachable"));
    expect(await tab.until(() => tab.shown("reconnectRetryBtn"), 15_000)).toBe(true);

    // Retry now: one more attempt, in place.
    const tries = network.attempts.length;
    tab.tap("reconnectRetryBtn");
    await tab.play(1_000);
    expect(network.attempts.length).toBeGreaterThan(tries);
    expect(tab.navigations).toEqual([]);

    // Thirty seconds on, the same button reloads the page, carrying the session; waiting alone never does.
    await tab.play(45_000);
    expect(tab.navigations).toEqual([]);
    tab.tap("reconnectRetryBtn");
    expect(await tab.until(() => tab.navigations.length > 0, 5_000)).toBe(true);
    expect(new URL(tab.navigations[0].url).searchParams.get("v")).toBeTruthy();
  }, 60_000);

  it("BOOT-13 a game canvas the browser lost for good reloads the page once, and never again inside the cooldown", async () => {
    const world = gameWorld();
    world.join("Ann").disconnect();
    /** The browser keeps one 2D context per canvas; the scenario can mark the game's lost. */
    const keepContexts = (tab: GameTab) => {
      const prototype = (tab.window as any).HTMLCanvasElement.prototype;
      const create = prototype.getContext;
      prototype.getContext = function getContext(this: { __context?: unknown }, kind: string) { return (this.__context ??= create.call(this, kind)); };
    };
    const loseGameCanvas = (tab: GameTab) => { ((tab.element("game") as HTMLCanvasElement).getContext("2d") as any).isContextLost = () => true; };

    let tab = await bootGame(world, { name: "Ann" });
    keepContexts(tab);
    expect(await tab.until(tab.playing, 20_000)).toBe(true);
    loseGameCanvas(tab);
    expect(await tab.until(() => tab.navigations.length > 0, 10_000)).toBe(true);
    expect(tab.navigations).toHaveLength(1);

    // The new page's canvas is lost as well: it does not reload again.
    tab = await tab.follow();
    keepContexts(tab);
    expect(await tab.until(tab.playing, 20_000)).toBe(true);
    loseGameCanvas(tab);
    await tab.play(60_000);
    expect(tab.navigations).toEqual([]);
  }, 60_000);
});
