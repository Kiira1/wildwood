import { describe, expect, it } from "vitest";
import { damageAfterArmor } from "./combat";
import { ENEMY_TYPES } from "./enemies";
import { lateMapReferenceBuild } from "../../shared/incoming-damage";
import { PLAYER_BASE_HP } from "../../shared/rules";

describe("late-map incoming damage", () => {
  it("preserves the tutorial and keeps extra armor useful", () => {
    // A new character survives more than four hits from the Spitters it starts on.
    expect(ENEMY_TYPES.Spitter.damage).toBeLessThan(PLAYER_BASE_HP / 4);
    const build = lateMapReferenceBuild(3), hit = ENEMY_TYPES["Geode Guardian"].damage;
    expect(damageAfterArmor(hit, build.armor * 10)).toBeLessThan(damageAfterArmor(hit, build.armor));
  });
});
