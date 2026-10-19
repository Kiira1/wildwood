import { describe, expect, it } from "vitest";
import { PLAYER_SPEED } from "../../shared/rules";
import { armorMoveSpeedFactor } from "../../shared/armor-class-perks";
import { simulationTravelSeconds } from "./gameplay-model";

describe("simulator parity with gameplay", () => {
  it("walks at the armor classes' pace on top of research and boots", () => {
    const light = armorMoveSpeedFactor("common_light_helmet", "rare_light_armor"), heavy = armorMoveSpeedFactor("", "epic_heavy_armor");
    expect(simulationTravelSeconds(900, 0, false, light)).toBeCloseTo(900 / (PLAYER_SPEED * 1.06));
    expect(simulationTravelSeconds(900, 10, true, heavy)).toBeCloseTo(900 / ((PLAYER_SPEED * 1.2 + 25) * .96));
  });

  it("only gives Black Boots' flat speed bonus after five seconds without combat", () => {
    // Black Boots are flat now: 25/s on top of the base speed.
    const shod = PLAYER_SPEED + 25;
    expect(simulationTravelSeconds(shod, 0, true)).toBeCloseTo(1);
    expect(simulationTravelSeconds(900, 0, true)).toBeCloseTo(900 / shod);
    expect(simulationTravelSeconds(shod, 0, false)).toBeCloseTo(shod / PLAYER_SPEED);
    expect(simulationTravelSeconds(241, 10, true)).toBeCloseTo(241 / (PLAYER_SPEED * 1.2 + 25));
  });
});
