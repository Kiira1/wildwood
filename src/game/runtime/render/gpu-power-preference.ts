/**
 * Which graphics card the WebGL world asks for: the integrated one unless the Dedicated GPU setting is on. A
 * dedicated card costs power just by being awake, which on a laptop is heat and battery whatever the game draws.
 */
export const DEDICATED_GPU_KEY = "wildstat-dedicated-gpu-v1";

export function dedicatedGpuWanted() {
  try { return localStorage.getItem(DEDICATED_GPU_KEY) === "true"; } catch { return false; }
}

/** The WebGL Drawing setting: off draws the whole world on the 2D canvas, for a machine WebGL lags on. */
export const WEBGL_WORLD_KEY = "wildstat-webgl-world-v1";

export function webGLWorldWanted() {
  try { return localStorage.getItem(WEBGL_WORLD_KEY) !== "false"; } catch { return true; }
}

export function worldPowerPreference(): WebGLPowerPreference {
  return dedicatedGpuWanted() ? "high-performance" : "default";
}
