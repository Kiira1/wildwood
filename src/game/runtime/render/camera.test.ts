import { ONBOARDING_WORLD } from "../../../../shared/onboarding";
import { WORLD } from "../../constants";
import { HOME_WORLD_WIDTH, HOME_WORLD_HEIGHT } from "../../../../shared/home";
import { describe, expect, it } from "vitest";
import { createCamera, snapCameraToPlayer } from "./camera";

// Phone and desktop framing, zoom levels and research are checked by the world and town scenes (tools/visual-check);
// these are screens wider than the scenes' page.
describe("runtime camera on wide screens", () => {
  const player = { x: 900, y: 700, attackRange: 180 };

  it("centers Home when a desktop viewport is wider than the lawn", () => {
    const original = { ...WORLD };
    try {
      WORLD.w = HOME_WORLD_WIDTH;
      WORLD.h = HOME_WORLD_HEIGHT;
      const wideViewport = { width: 2560, height: 900 };
      const camera = createCamera();
      snapCameraToPlayer(camera, { ...player, x: 600, y: 950 }, wideViewport);
      expect(wideViewport.width / camera.zoom).toBeGreaterThan(WORLD.w);
      expect((WORLD.w / 2 - camera.x) * camera.zoom).toBeCloseTo(wideViewport.width / 2);
    } finally {
      Object.assign(WORLD, original);
    }
  });

  it.each([{ width: 1920, height: 1080 }, { width: 3440, height: 1440 }, { width: 5120, height: 1440 }])("fills desktop tutorial framing with grass at $width × $height", viewport => {
    const original = { ...WORLD };
    try {
      WORLD.w = ONBOARDING_WORLD.width; WORLD.h = ONBOARDING_WORLD.height;
      const camera = createCamera();
      snapCameraToPlayer(camera, { ...player, ...ONBOARDING_WORLD.spawn }, viewport);
      expect(camera.x).toBeGreaterThanOrEqual(0);
      expect(camera.y).toBeGreaterThanOrEqual(0);
      expect(camera.x + viewport.width / camera.zoom).toBeLessThanOrEqual(WORLD.w);
      expect(camera.y + viewport.height / camera.zoom).toBeLessThanOrEqual(WORLD.h);
      expect((ONBOARDING_WORLD.spawn.x - camera.x) * camera.zoom).toBeCloseTo(viewport.width / 2);
    } finally { Object.assign(WORLD, original); }
  });
});
