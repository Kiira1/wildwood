import { afterEach, vi } from "vitest";
import { Identity } from "spacetimedb";
import { stubGameBootEnvironment } from "../../helpers/game-boot-environment";
import { LoadingImage, siteFetch } from "./browser";
import { accountStorageKeys } from "../../../src/coop/services/account-storage-keys";
import { defaultRealtimeHost } from "../../../src/coop/services/realtime-host";
import { connectClient, type ClientOptions, type FakeConnection } from "./client";
import { SCENARIO_START_MS, scenarioWorld, type PlayerKind, type ScenarioPlayer, type ScenarioWorld } from "./server";

// The network: the generated DbConnection is the client's only way to the
// server, so a booted game gets one whose socket is the scenario world.
vi.mock("../../../src/module_bindings", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const network = () => (globalThis as { __scenarioNetwork?: { builder: () => unknown } }).__scenarioNetwork;
  class DbConnection {
    static builder() {
      const current = network();
      if (!current) throw new Error("No scenario network: boot the game with bootGame()");
      return current.builder();
    }
  }
  return { ...real, DbConnection };
});

type Callback = (...args: any[]) => void;

afterEach(() => {
  delete (navigator as { onLine?: boolean }).onLine;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (globalThis as { __scenarioNetwork?: unknown }).__scenarioNetwork;
});

/** Fake timers (the browser's clocks) and a server that reads them, for booted games. */
export function gameWorld(options: { start?: number; seed?: number } = {}) {
  vi.useFakeTimers({ now: options.start ?? SCENARIO_START_MS, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  return scenarioWorld({ seed: options.seed, clock: () => Date.now() });
}

/** Who connects with which token: the token a client stores is the player's name. */
function scenarioNetwork(world: ScenarioWorld, options: { guestName: () => string; kind: (token: string | undefined) => PlayerKind; client?: ClientOptions; refuse?: () => Error | null }) {
  const players = new Map<string, ScenarioPlayer>();
  const connections: FakeConnection[] = [];
  /** The sign-in each account socket was opened with, as the host checked it when trading it for a socket token. */
  let socketCredential: string | null = null;
  /**
   * The host's /v1/identity/websocket-token: an expired ID token is refused
   * (401), as SpacetimeDB refuses it; a good one is remembered for the socket.
   */
  function socketToken(init?: RequestInit) {
    const headers = new Headers(init?.headers);
    const bearer = headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    const expires = accountClaims(bearer)?.exp ?? 0;
    if (!accountSubject(bearer) || expires * 1000 <= Date.now()) return new Response("{}", { status: 401, statusText: "Unauthorized" });
    socketCredential = bearer;
    return new Response(JSON.stringify({ token: "socket-token" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const builder = () => {
    let token: string | undefined;
    let socketFactory: ((args: Record<string, unknown>) => Promise<unknown>) | null = null;
    const on: Record<string, Callback> = {};
    const self = {
      withUri: () => self, withDatabaseName: () => self, withModuleName: () => self,
      withWSFn: (factory: typeof socketFactory) => { socketFactory = factory; return self; },
      withCompression: () => self, withLightMode: () => self, withConfirmedReads: () => self,
      withToken: (value?: string) => { token = value; return self; },
      onConnect: (callback: Callback) => { on.connect = callback; return self; },
      onDisconnect: (callback: Callback) => { on.disconnect = callback; return self; },
      onConnectError: (callback: Callback) => { on.connectError = callback; return self; },
      build() {
        // A signed-in token (an ID token) opens the account its subject names.
        const subject = accountSubject(token);
        const name = token?.startsWith("scenario:") ? token.slice("scenario:".length) : subject ?? options.guestName();
        const refusal = options.refuse?.();
        if (refusal) {
          const placeholder = { isActive: false, isDisconnectRequested: false, isSocketClosed: true, disconnect() {} };
          queueMicrotask(() => on.connectError?.({}, refusal));
          return placeholder;
        }
        const open = (name: string, account: string | null) => {
          let player = players.get(name);
          if (!player) { player = world.player(name, account ? "account" : options.kind(token)); players.set(name, player); }
          const connection = connectClient(world, player, options.client);
          connections.push(connection);
          connection.fake.onDisconnect((ctx, error) => on.disconnect?.(ctx, error));
          queueMicrotask(() => on.connect?.(connection, new Identity(player!.hex), account ?? `scenario:${name}`));
          return connection;
        };
        if (!subject || !socketFactory) return open(name, subject ? token! : null);
        // A sign-in goes through the page's own socket factory, as the SDK sends it:
        // renewed if it has run out, traded for a socket token, refused when the host says so.
        let cancelled = false;
        const placeholder = { isActive: false, isDisconnectRequested: false, isSocketClosed: true, disconnect() { cancelled = true; } };
        socketCredential = null;
        void Promise.resolve(socketFactory({ url: new URL("wss://maincloud.spacetimedb.com"), nameOrAddress: "wildwood-coop", wsProtocol: "v2.bsatn.spacetimedb", authToken: token, compression: "none", lightMode: false }))
          .then(() => {
            if (cancelled) return;
            const credential = socketCredential ?? token!;
            open(accountSubject(credential)!, credential);
          }, error => { if (!cancelled) on.connectError?.({}, error); });
        return placeholder;
      },
    };
    return self;
  };
  return { builder, players, connections, socketToken };
}

/** The claims of an ID token (header.claims.signature), or null for a guest token. */
function accountClaims(token: string | undefined) {
  const parts = token?.split(".");
  if (!parts || parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: string; exp?: number }; } catch { return null; }
}
const accountSubject = (token: string | undefined) => accountClaims(token)?.sub ?? null;

/** The socket the page's factory opens once its token is traded: it stays quiet (the scenario network carries the game). */
class QuietSocket {
  readyState = 0;
  protocol = "";
  binaryType = "blob";
  onopen = null; onclose = null; onerror = null; onmessage = null;
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() {}
}

/** Where the page asked the browser to go: a link followed, a replace, a reload. */
export type Navigation = { how: "assign" | "replace" | "reload"; url: string };

/** window.location with its navigation methods, which record instead of leaving the page. */
function pageLocation(href: string, navigations: Navigation[]) {
  const location = new URL(href) as URL & { assign: (url: string | URL) => void; replace: (url: string | URL) => void; reload: () => void };
  const resolve = (url: string | URL) => new URL(String(url), location.href).href;
  location.assign = url => { navigations.push({ how: "assign", url: resolve(url) }); };
  location.replace = url => { navigations.push({ how: "replace", url: resolve(url) }); };
  location.reload = () => { navigations.push({ how: "reload", url: location.href }); };
  const history = {
    state: null as unknown,
    length: 1,
    replaceState(state: unknown, _title: string, url?: string | URL | null) { history.state = state; if (url != null) location.href = resolve(url); },
    pushState(state: unknown, _title: string, url?: string | URL | null) { history.state = state; history.length++; if (url != null) location.href = resolve(url); },
    back() {}, forward() {}, go() {},
  };
  return { location, history };
}

const guestsMade = new WeakMap<ScenarioWorld, number>();

/** The browser storage keys the client uses on wildstatmmo.com. */
export const storageKeys = accountStorageKeys(defaultRealtimeHost("wildstatmmo.com"), "wildwood-coop");

export type GameOptions = {
  /** The guest's character name on the server (its stored token). */
  name?: string;
  kind?: PlayerKind;
  client?: ClientOptions;
  /** Storage carried over from an earlier boot (a reload). */
  localStorage?: Storage;
  sessionStorage?: Storage;
  /** Answers fetches the site does not serve itself (OAuth, the version check). */
  route?: (url: URL, init?: RequestInit) => Response | Promise<Response> | null;
  /** The address the page opens at (an OAuth return, a ?v= update reload); wildstatmmo.com by default. */
  url?: string;
  /** While it returns an error, every connection the page opens is refused with it. */
  refuse?: () => Error | null;
  /** Set on the page's window before anything loads, as a host page would (e.g. the phone app's WILDSTAT_NATIVE_PREVIEW). */
  windowProps?: Record<string, unknown>;
};

/**
 * Boots the real client the way index.html does — coop-client.js, then the
 * game bundle it loads — against the scenario world. Browser globals are
 * linkedom with fake storage, timers and frames; the only fake on the game's
 * side is the network (DbConnection). Use vi.useFakeTimers() first.
 */
export async function bootGame(world: ScenarioWorld, options: GameOptions = {}) {
  vi.resetModules();
  const base = stubGameBootEnvironment();
  // linkedom's window writes defined properties through to Node's globalThis, where
  // the client pins window.wildstatCoop for good; a window of this page's own takes them.
  const window = Object.create(base.window) as typeof base.window;
  for (const name of ["window", "self"]) vi.stubGlobal(name, window);
  vi.stubGlobal("addEventListener", window.addEventListener.bind(window));
  vi.stubGlobal("removeEventListener", window.removeEventListener.bind(window));
  const env = { ...base, window };
  Object.assign(window, options.windowProps ?? {});
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    const kept = options[kind];
    if (kept) { vi.stubGlobal(kind, kept); (env.window as any)[kind] = kept; }
  }
  // document.currentScript, as the browser reports it while game.js runs.
  let currentScript: unknown = null;
  const documentClass = Object.getPrototypeOf(env.document).constructor;
  Object.defineProperty(documentClass.prototype, "currentScript", { configurable: true, get: () => currentScript });
  vi.stubGlobal("Document", documentClass);
  // The page's address; navigations are recorded for the scenario to follow (tab.follow()).
  const navigations: Navigation[] = [];
  const page = pageLocation(options.url ?? "https://wildstatmmo.com/", navigations);
  for (const name of ["location", "history"] as const) {
    vi.stubGlobal(name, page[name]);
    Object.defineProperty(env.window, name, { configurable: true, writable: true, value: page[name] });
  }
  // Online until the scenario takes the network away (Node's navigator has no onLine).
  let online = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  // A visible, focused tab until the scenario hides it.
  let pageHidden = false;
  Object.defineProperty(env.document, "hidden", { configurable: true, get: () => pageHidden });
  Object.defineProperty(env.document, "visibilityState", { configurable: true, get: () => pageHidden ? "hidden" : "visible" });
  (env.document as any).hasFocus = () => !pageHidden;
  // Art loads from public/ at its real size; fetch serves the site's files.
  vi.stubGlobal("Image", LoadingImage);
  (env.window as any).Image = LoadingImage;
  // The host's socket-token endpoint is the scenario network's; everything else is the site or `route`.
  let host: { socketToken: (init?: RequestInit) => Response } | null = null;
  const fetcher = siteFetch((url, init) => url.pathname.endsWith("/v1/identity/websocket-token") && host
    ? host.socketToken(init) : options.route?.(url, init) ?? null);
  vi.stubGlobal("WebSocket", QuietSocket);
  (env.window as any).WebSocket = QuietSocket;
  vi.stubGlobal("fetch", fetcher);
  (env.window as any).fetch = fetcher;
  const imagePrototype = (env.window as any).HTMLImageElement.prototype;
  Object.defineProperty(imagePrototype, "src", {
    configurable: true,
    get() { return this.getAttribute("src") ?? ""; },
    set(value: string) {
      this.setAttribute("src", value);
      const probe = new LoadingImage();
      probe.onload = () => {
        Object.assign(this, { complete: true, naturalWidth: probe.naturalWidth, naturalHeight: probe.naturalHeight });
        this.onload?.({ type: "load", target: this });
        this.dispatchEvent(new (env.window as any).Event("load"));
      };
      probe.onerror = () => {
        Object.assign(this, { complete: true });
        this.onerror?.({ type: "error", target: this });
        this.dispatchEvent(new (env.window as any).Event("error"));
      };
      probe.src = value;
    },
  });
  imagePrototype.decode ??= function decode(this: { naturalWidth?: number }) { return this.naturalWidth ? Promise.resolve() : Promise.reject(new Error("Image failed")); };
  const network = scenarioNetwork(world, {
    // New guests are numbered across the world, so a second fresh browser is a second guest.
    guestName: () => options.name ?? `guest-${(guestsMade.set(world, (guestsMade.get(world) ?? 0) + 1), guestsMade.get(world))}`,
    kind: () => options.kind ?? "guest",
    client: options.client,
    refuse: () => options.refuse?.() ?? null,
  });
  host = network;
  (globalThis as { __scenarioNetwork?: unknown }).__scenarioNetwork = network;
  if (options.name && !options.localStorage) {
    // A returning guest: the stored token names the character.
    localStorage.setItem(storageKeys.guestTokenKey, `scenario:${options.name}`);
  }

  const coop = await import("../../../src/wildstat-coop");
  let game: unknown = null;
  /** Runs game.js when the coop bundle has inserted its script tag, as the browser would. */
  async function loadGameScript() {
    const script = env.document.getElementById("wildstatGameScript");
    if (!script || game) return Boolean(game);
    currentScript = script;
    // game.js is a bundle of its own: fresh copies of every module it shares with coop-client.js.
    vi.resetModules();
    try { game = await import("../../../src/main"); } finally { currentScript = null; }
    script.dispatchEvent(new (env.window as any).Event("load"));
    // The page finishes loading once the game's script has run.
    Object.defineProperty(env.document, "readyState", { configurable: true, value: "complete" });
    env.window.dispatchEvent(new (env.window as any).Event("load"));
    return true;
  }

  const element = (id: string) => {
    const found = env.document.getElementById(id);
    if (!found) throw new Error(`No element #${id}`);
    return found as HTMLElement;
  };
  /** Shown on screen: neither it nor any parent is hidden. */
  const hiddenNode = (node: HTMLElement) => node.hasAttribute?.("hidden") || node.style?.display === "none"
    || (node.tagName === "DIALOG" && !node.hasAttribute("open"));
  const shown = (id: string) => {
    const found = env.document.getElementById(id);
    for (let node: HTMLElement | null = found; node; node = node.parentElement) if (hiddenNode(node)) return false;
    return Boolean(found);
  };
  /** Ids of the elements on screen that have one: what the player can see, for finding a scenario's next tap. */
  const screen = (filter: RegExp = /./) => [...env.document.querySelectorAll("[id]")].map(node => (node as HTMLElement).id)
    .filter(id => filter.test(id) && shown(id));

  const tab = {
    ...env, world, coop: coop.wildstatCoop, network, element, shown, screen, navigations, location: page.location,
    localStorage: localStorage as Storage, sessionStorage: sessionStorage as Storage,
    /** A tap on an element by id, as the player's finger would land it. */
    tap(id: string) {
      const target = element(id);
      if ((target as HTMLButtonElement).disabled) throw new Error(`#${id} is disabled`);
      target.dispatchEvent(new (env.window as any).Event("pointerdown", { bubbles: true }));
      target.dispatchEvent(new (env.window as any).Event("pointerup", { bubbles: true }));
      target.dispatchEvent(new (env.window as any).Event("click", { bubbles: true }));
    },
    /** The tab goes to the background (true) or comes back (false), as a phone sleeping or a tab switch does. */
    setHidden(hidden: boolean) {
      if (pageHidden === hidden) return;
      pageHidden = hidden;
      env.document.dispatchEvent(new (env.window as any).Event("visibilitychange"));
      env.window.dispatchEvent(new (env.window as any).Event(hidden ? "pagehide" : "pageshow"));
      if (!hidden) env.window.dispatchEvent(new (env.window as any).Event("focus"));
    },
    /** The device loses (false) or regains (true) its network, as the browser reports it. */
    setOnline(next: boolean) {
      if (online === next) return;
      online = next;
      env.window.dispatchEvent(new (env.window as any).Event(next ? "online" : "offline"));
    },
    /** Presses a key (by code: "KeyD", "ArrowLeft", "Escape"); `up` releases it. */
    key(code: string, type: "keydown" | "keyup" = "keydown", target: EventTarget = env.window as unknown as EventTarget) {
      const event = new (env.window as any).Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { code, key: code.replace(/^Key/, "").toLowerCase() });
      target.dispatchEvent(event);
    },
    /** A key held down for `ms` of play, then released. */
    async hold(code: string, ms: number) {
      this.key(code);
      await this.play(ms);
      this.key(code, "keyup");
    },
    loadGameScript,
    /** The connections this tab has opened, newest last. */
    connection: () => network.connections[network.connections.length - 1] ?? null,
    /** Advances fake time, letting replies land and drawing a frame every `frameMs` (20 a second by default). */
    async play(ms: number, frameMs = 50) {
      const steps = Math.max(1, Math.round(ms / frameMs));
      for (let step = 0; step < steps; step++) {
        await vi.advanceTimersByTimeAsync(frameMs);
        // A hidden tab gets no animation frames, as in a browser.
        if (!pageHidden) env.runFrames(1, performance.now());
        await loadGameScript();
      }
    },
    /** Plays until `done()` holds, up to `ms`; false when it never did. */
    async until(done: () => boolean, ms = 10_000, frameMs = 50) {
      for (let waited = 0; waited < ms; waited += frameMs) {
        if (done()) return true;
        await tab.play(frameMs, frameMs);
      }
      return done();
    },
    /** A new visitor's Terms window: Play (as an adult) once it shows. */
    async acceptTerms() {
      if (!await tab.until(() => tab.shown("legalContinueBtn") && !(tab.element("legalContinueBtn") as HTMLButtonElement).disabled)) throw new Error("The Terms never showed");
      tab.tap("legalContinueBtn");
      await tab.play(1_000);
    },
    /** In the world and playing: the start screen has gone. */
    playing: () => !tab.shown("start") && tab.coop.isConnected() === true,
    /**
     * The same browser loads the page again: this tab's timers and socket end,
     * storage stays, and a fresh page boots (the old one is gone, as after F5).
     */
    async reload(next: Partial<GameOptions> = {}) {
      await tab.close();
      return bootGame(world, { ...options, name: undefined, url: page.location.href, ...next, localStorage: tab.localStorage, sessionStorage: tab.sessionStorage });
    },
    /**
     * The page goes away: its sockets close, the work their closing starts runs
     * out, then its timers stop, so nothing of it reaches a page opened after.
     */
    async close() {
      for (const connection of network.connections) connection.disconnect();
      for (let round = 0; round < 20; round++) await Promise.resolve();
      // Clearing the timers resets the fake clock too; the wall clock carries on (performance.now restarts, as on a real reload).
      const wallClock = Date.now();
      vi.clearAllTimers();
      vi.setSystemTime(wallClock);
    },
    /** The browser goes where the page last sent it (a same-site address loads the game there). */
    async follow(next: Partial<GameOptions> = {}) {
      const last = navigations[navigations.length - 1];
      if (!last) throw new Error("The page never navigated");
      return tab.reload({ url: last.url, ...next });
    },
  };
  return tab;
}

/**
 * A character that already exists on the server (made with world.join), opened
 * in a browser that remembers its guest sign-in, and played until it is in the world.
 */
export async function playAs(world: ScenarioWorld, name: string, options: Omit<GameOptions, "name"> & { join?: Parameters<ScenarioWorld["join"]>[1] } = {}) {
  const kind = options.join?.kind ?? options.kind ?? "guest";
  if (!world.db.playerLegalConsent.identity.find(world.player(name, kind).identity)) world.join(name, { ...options.join, kind }).disconnect();
  const tab = await bootGame(world, { ...options, kind, name });
  if (!await tab.until(tab.playing, 20_000)) throw new Error(`${name} never reached the world: ${tab.screen(/Panel|Btn/).join(", ")}`);
  return tab;
}
export type GameTab = Awaited<ReturnType<typeof bootGame>>;
