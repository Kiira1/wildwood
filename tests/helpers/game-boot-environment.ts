import { parseHTML } from "linkedom";
import { vi } from "vitest";
import { createEmptyResearchRanks } from "../../shared/research";
import { installGameShell } from "../../src/ui/game-shell";
import { entryHtml } from "./game-document";

/** A Storage kept in memory, as a fresh browser profile would start. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); },
    clear: () => values.clear(),
  };
}

/** A 2D context that accepts every call and draws nothing. */
function nullContext2d(canvas: unknown): CanvasRenderingContext2D {
  const gradient = { addColorStop() {} };
  const fixed: Record<string, unknown> = {
    canvas,
    measureText: (text: string) => ({ width: String(text).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
  };
  const assigned: Record<string | symbol, unknown> = {};
  return new Proxy({}, {
    get: (_target, key) => key in fixed ? fixed[key as string] : key in assigned ? assigned[key] : () => undefined,
    set: (_target, key, value) => { assigned[key] = value; return true; },
  }) as CanvasRenderingContext2D;
}

/** Images and sounds that never load, so nothing waits on the network. */
class StubImage {
  src = "";
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  decode() { return Promise.resolve(); }
  addEventListener() {}
  removeEventListener() {}
}

class StubAudio {
  src = "";
  volume = 1;
  loop = false;
  muted = false;
  paused = true;
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
  addEventListener() {}
  removeEventListener() {}
}

class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** linkedom's DOM classes the game checks instances against. */
const DOM_CLASSES = [
  "HTMLElement", "HTMLCanvasElement", "HTMLImageElement", "HTMLButtonElement", "HTMLInputElement",
  "Element", "Node", "Event", "CustomEvent", "KeyboardEvent",
];

/**
 * Stubs the browser globals the game reads at startup, on a linkedom copy of public/index.html.
 * There is no coop client unless a test adds one; undo with vi.unstubAllGlobals().
 */
export function stubGameBootEnvironment() {
  const { window, document } = parseHTML(entryHtml);
  installGameShell(document);
  const frames: FrameRequestCallback[] = [];
  const view = window as unknown as Record<string, unknown>;
  const canvasPrototype = (window as unknown as { HTMLCanvasElement: { prototype: Record<string, unknown> } }).HTMLCanvasElement.prototype;
  canvasPrototype.getContext = function getContext(this: unknown, kind: string) {
    return kind === "2d" ? nullContext2d(this) : null;
  };
  const elementPrototype = (window as unknown as { Element: { prototype: Record<string, unknown> } }).Element.prototype;
  elementPrototype.getBoundingClientRect ??= () => ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  const globals: Record<string, unknown> = {
    window, document, self: window,
    localStorage: memoryStorage(), sessionStorage: memoryStorage(),
    location: new URL("https://wildstatmmo.com/"),
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
    Image: StubImage, Audio: StubAudio,
    ResizeObserver: StubObserver, IntersectionObserver: StubObserver, MutationObserver: StubObserver,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; },
    cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    fetch: () => new Promise(() => {}),
    Worker: undefined,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  };
  for (const name of DOM_CLASSES) globals[name] = view[name];
  for (const [name, value] of Object.entries(globals)) {
    if (name !== "window" && name !== "document" && name !== "self") view[name] ??= value;
    vi.stubGlobal(name, value);
  }
  view.location = globals.location;
  view.localStorage = globals.localStorage;
  view.sessionStorage = globals.sessionStorage;
  /** Runs the animation frames requested so far, as the browser's next paint would. */
  function runFrames(count: number, startMs = 1_000) {
    for (let frame = 0; frame < count; frame += 1) {
      for (const callback of frames.splice(0)) callback(startMs + frame * 16);
    }
  }
  return { window, document, runFrames };
}

/**
 * A coop client that never connects: the methods startup reads return what a
 * fresh page shows before its first server row, and the rest return nothing.
 */
export function disconnectedCoopClient() {
  let onChange: (() => void) | null = null;
  const nothing = () => undefined;
  const bag = (values: Record<string, unknown>) => new Proxy(values, {
    get: (target, key) => key === "then" ? undefined : key in target ? target[key as string] : nothing,
  });
  const client = bag({
    accountAudio: bag({ snapshot: () => ({ loaded: false }), subscribe: () => () => {} }),
    guild: bag({}), social: bag({}), devModeration: bag({}),
    setOnChange: (callback: (() => void) | null) => { onChange = callback; },
    accountState: () => ({}), localIdentity: () => "", isConnected: () => false,
    remotePlayers: () => [], chatMessages: () => [], gemBalance: () => 0n, gold: () => 0n,
    research: createEmptyResearchRanks, researchInPlay: createEmptyResearchRanks,
  });
  return { client, notifyChange: () => onChange?.() };
}
