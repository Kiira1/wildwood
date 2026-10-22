import { SpriteRecorderUnsupported } from "./sprite-recorder";

/**
 * A 2D context that passes every call and property to its current target: the game's canvas context, or
 * for the world part of a frame, the sprite recorder (sprite-recorder.ts). Everything that draws the world
 * holds this one object, so switching the target moves all of its drawing without changing any of it.
 */
/** Calls that put pixels on the canvas they are made on. */
const DRAWING_METHODS = new Set(["drawImage", "fillRect", "strokeRect", "fill", "stroke", "fillText", "strokeText", "putImageData"]);

export function createSwitchableContext(real: CanvasRenderingContext2D) {
  if (typeof CanvasRenderingContext2D === "undefined" || !(real instanceof CanvasRenderingContext2D)) {
    return { context: real, real, canSwitch: false, use(_next: CanvasRenderingContext2D) {}, reset() {}, realDraws: () => -1 };
  }
  let realDraws = 0;
  let target: CanvasRenderingContext2D = real;
  const facade: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (let proto = Object.getPrototypeOf(real); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor" || seen.has(name)) continue;
      seen.add(name);
      const descriptor = Object.getOwnPropertyDescriptor(proto, name)!;
      if (typeof descriptor.value === "function") {
        const drawing = DRAWING_METHODS.has(name);
        facade[name] = function () {
          if (drawing && target === real) realDraws += 1;
          const method = (target as unknown as Record<string, unknown>)[name];
          if (typeof method !== "function") throw new SpriteRecorderUnsupported(name);
          // eslint-disable-next-line prefer-rest-params
          return method.apply(target, arguments as unknown as unknown[]);
        };
      } else if (descriptor.get) {
        Object.defineProperty(facade, name, {
          get: () => (target as unknown as Record<string, unknown>)[name],
          set: descriptor.set ? (value: unknown) => { (target as unknown as Record<string, unknown>)[name] = value; } : undefined,
          enumerable: true,
        });
      }
    }
  }
  return {
    context: facade as unknown as CanvasRenderingContext2D,
    real,
    canSwitch: true,
    use(next: CanvasRenderingContext2D) { target = next; },
    reset() { target = real; },
    /** How many drawing calls have reached the real canvas, so a frame can tell whether it left the canvas empty. */
    realDraws: () => realDraws,
  };
}

export type SwitchableContext = ReturnType<typeof createSwitchableContext>;
