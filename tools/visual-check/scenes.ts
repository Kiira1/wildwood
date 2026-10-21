import { DOM_SCENES } from "./scenes-dom";
import { WORLD_SCENES } from "./scenes-world";

/** Every scene, by its URL hash. capture.mjs reads the list from the page. */
export const SCENES: Record<string, () => Promise<void>> = { ...WORLD_SCENES, ...DOM_SCENES };
