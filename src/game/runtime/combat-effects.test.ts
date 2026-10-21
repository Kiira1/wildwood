import { describe, expect, it } from "vitest";
import { MAX_DAMAGE_NUMBERS, MAX_PARTICLES, createCombatEffects } from "./combat-effects";

// How hits, numbers and skill effects look is checked by the combat-hits scene (tools/visual-check).
describe("combat effects pool", () => {
  it("caps and recycles transient effects", () => {
    const effects = createCombatEffects();
    for (let index = 0; index < MAX_PARTICLES + 50; index += 1) effects.spawnParticle(0, 0, 0, 0, 1, 1, 1, "#fff");
    for (let index = 0; index < MAX_DAMAGE_NUMBERS + 20; index += 1) effects.spawnDamageNumber(0, 0, 1);
    expect(effects.particles).toHaveLength(MAX_PARTICLES);
    expect(effects.damageNumbers).toHaveLength(MAX_DAMAGE_NUMBERS);
    effects.update(2);
    expect(effects.particles).toHaveLength(0);
    expect(effects.damageNumbers).toHaveLength(0);
  });

  it("clears actor anchors before reusing a sword effect", () => {
    const effects = createCombatEffects(), player = { x: 10, y: 20 };
    effects.spawnSwordSpin(10, 20, 110, .6, player);
    expect(effects.skillEffects[0].anchor).toBe(player);
    effects.update(1);
    effects.spawnSwordWave(0, 0, 260, 0, 20, .5);
    expect(effects.skillEffects[0].anchor).toBeUndefined();
  });
});
