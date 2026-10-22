/**
 * Which graphics card the WebGL world asks for: the integrated one unless the Dedicated GPU setting is on. A
 * dedicated card costs power just by being awake, which on a laptop is heat and battery whatever the game draws.
 */
export const DEDICATED_GPU_KEY = "wildstat-dedicated-gpu-v1";

export function dedicatedGpuWanted() {
  try { return localStorage.getItem(DEDICATED_GPU_KEY) === "true"; } catch { return false; }
}

export function worldPowerPreference(): WebGLPowerPreference {
  return dedicatedGpuWanted() ? "high-performance" : "default";
}
