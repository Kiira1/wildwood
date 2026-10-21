import { afterEach } from "vitest";
import { bootGame, type GameOptions, type GameTab } from "./game";
import { LoadingImage } from "./browser";
import type { ScenarioWorld } from "./server";

/**
 * The browser's side of drawing, for the rendering scenarios: which images the
 * page asks for (and a flaky network that fails some), a GPU whose WebGL
 * context can be lost or run out of memory, and a 2D canvas that can fail a draw.
 */

const undo: (() => void)[] = [];
afterEach(() => { while (undo.length) undo.pop()!(); });

/** Every image source the page sets, in order; `fail` makes matching requests fail as a dropped download would. */
export function watchArt() {
  const requests: string[] = [];
  let fail: (url: string) => boolean = () => false;
  const descriptor = Object.getOwnPropertyDescriptor(LoadingImage.prototype, "src")!;
  Object.defineProperty(LoadingImage.prototype, "src", {
    configurable: true,
    get: descriptor.get,
    set(this: LoadingImage, value: string) {
      requests.push(value);
      // Set to a path the site does not serve: the image fails as a dropped download does.
      descriptor.set!.call(this, fail(value) ? `/dropped/${value}` : value);
    },
  });
  // A real <img> lets go of its source this way when the game releases a map's art.
  const prototype = LoadingImage.prototype as unknown as { removeAttribute?: (name: string) => void };
  const hadRemove = Object.prototype.hasOwnProperty.call(prototype, "removeAttribute");
  if (!hadRemove) prototype.removeAttribute = function (this: LoadingImage, name: string) { if (name === "src") descriptor.set!.call(this, ""); };
  undo.push(() => {
    Object.defineProperty(LoadingImage.prototype, "src", descriptor);
    if (!hadRemove) delete prototype.removeAttribute;
  });
  return {
    requests,
    /** Requests whose path contains `part`. */
    asked: (part: string) => requests.filter(url => url.includes(part)),
    failWhen(rule: (url: string) => boolean) { fail = rule; },
  };
}

/** Enough of a WebGL context for the game's world layer; it can be lost, restored, or run out of memory on uploads. */
export function fakeGpu() {
  let lost = false, outOfMemory = false;
  const gl = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key === "isContextLost") return () => lost;
      if (key === "getShaderParameter" || key === "getProgramParameter") return () => true;
      if (key === "getError") return () => (outOfMemory ? 0x505 : 0);
      if (key === "getAttribLocation") return () => 0;
      if (key === "getParameter") return () => 8_192;
      if (key === "NO_ERROR") return 0;
      if (typeof key === "string" && /^[A-Z0-9_]+$/.test(key)) return 1;
      if (key in target) return target[key];
      return () => ({});
    },
  });
  return {
    gl: gl as unknown as WebGLRenderingContext,
    lose() { lost = true; },
    restore() { lost = false; },
    runOutOfMemory() { outOfMemory = true; },
  };
}

/**
 * A 2D context over the page's own that keeps its transform and save stack as a browser does (a resized
 * canvas starts over), and can fail its next draw.
 */
function drawingContext(inner: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  const state = { draws: 0, failNext: false, transform: [1, 0, 0, 1, 0, 0] as number[], saved: [] as number[][] };
  const multiply = (m: number[], [a, b, c, d, e, f]: number[]) => [
    m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5],
  ];
  const context = new Proxy(inner as unknown as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key === "canvas") return canvas;
      if (key === "setTransform") return (...values: (number | DOMMatrix2DInit)[]) => {
        const [first] = values;
        state.transform = typeof first === "object" ? [first.a ?? 1, first.b ?? 0, first.c ?? 0, first.d ?? 1, first.e ?? 0, first.f ?? 0] : (values as number[]).slice(0, 6);
      };
      if (key === "resetTransform") return () => { state.transform = [1, 0, 0, 1, 0, 0]; };
      if (key === "getTransform") return () => { const [a, b, c, d, e, f] = state.transform; return { a, b, c, d, e, f }; };
      if (key === "scale") return (x: number, y: number) => { state.transform = multiply(state.transform, [x, 0, 0, y, 0, 0]); };
      if (key === "translate") return (x: number, y: number) => { state.transform = multiply(state.transform, [1, 0, 0, 1, x, y]); };
      if (key === "rotate") return (angle: number) => { state.transform = multiply(state.transform, [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]); };
      if (key === "save") return () => { state.saved.push(state.transform); };
      if (key === "restore") return () => { state.transform = state.saved.pop() ?? state.transform; };
      if (key === "drawImage" || key === "fillRect") return () => {
        if (state.failNext) { state.failNext = false; throw new Error("GPU draw failed"); }
        state.draws += 1;
      };
      return target[key];
    },
    set(target, key, value) {
      if (key === "canvas") return true;
      target[key] = value;
      return true;
    },
  });
  // Setting a canvas's width clears its context: transform and save stack start over.
  const element = canvas as unknown as Record<string, unknown>;
  let width = Number(element.width) || 0;
  Object.defineProperty(canvas, "width", {
    configurable: true,
    get: () => width,
    set: (value: number) => { width = value; state.transform = [1, 0, 0, 1, 0, 0]; state.saved = []; },
  });
  return { context: context as unknown as CanvasRenderingContext2D, state };
}

/**
 * A character that exists on the server, opened in a browser with this GPU, played until it is in the world.
 * `devicePixelRatio` is the screen's (a 3× phone, say).
 */
export async function playWithGpu(world: ScenarioWorld, name: string, options: { gpu?: ReturnType<typeof fakeGpu>; devicePixelRatio?: number } & Omit<GameOptions, "name"> = {}) {
  if (!world.db.playerLegalConsent.identity.find(world.player(name, "guest").identity)) world.join(name).disconnect();
  const tab = await bootGame(world, { ...options, name });
  const view = tab.window as unknown as { HTMLCanvasElement: { prototype: { getContext: (this: HTMLCanvasElement, kind: string, attributes?: unknown) => unknown } }; devicePixelRatio: number };
  if (options.devicePixelRatio) {
    view.devicePixelRatio = options.devicePixelRatio;
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = options.devicePixelRatio;
  }
  const original = view.HTMLCanvasElement.prototype.getContext;
  const contexts = new Map<HTMLCanvasElement, ReturnType<typeof drawingContext>>();
  view.HTMLCanvasElement.prototype.getContext = function (kind, attributes) {
    if (kind === "webgl" || kind === "experimental-webgl") return options.gpu?.gl ?? null;
    if (kind !== "2d") return original.call(this, kind, attributes);
    if (!contexts.has(this)) contexts.set(this, drawingContext(original.call(this, kind, attributes) as CanvasRenderingContext2D, this));
    return contexts.get(this)!.context;
  };
  if (!await tab.until(tab.playing, 20_000)) throw new Error(`${name} never reached the world`);
  const game = tab.element("game") as HTMLCanvasElement;
  return Object.assign(tab, {
    /** The main game canvas's drawing: how many things it has drawn, its transform now and how deep its save stack is. */
    canvas: () => ({ element: game, ...contexts.get(game)!.state, depth: contexts.get(game)!.state.saved.length }),
    failNextDraw() { contexts.get(game)!.state.failNext = true; },
  });
}
export type GpuTab = Awaited<ReturnType<typeof playWithGpu>> & GameTab;
